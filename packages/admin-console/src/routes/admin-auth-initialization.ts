import type { AuthProvider, CheckResult } from '@svadmin/core';
import type { AdminMfaFactor, AdminMfaStepUpState } from '$lib/admin-mfa-step-up';
import { runBoundedAdminRequest } from '$lib/admin-api';

type AdminInitializationErrorCode =
  | 'authentication_required'
  | 'forbidden'
  | 'service_unavailable'
  | 'request_timeout'
  | 'request_aborted'
  | 'sso_not_configured'
  | 'auth_check_failed'
  | 'login_failed'
  | 'initialization_failed';

export type AdminAuthInitializationState =
  | { kind: 'checking'; pending: true }
  | { kind: 'authenticated'; pending: false; provider: AuthProvider }
  | { kind: 'redirect'; pending: false; provider: AuthProvider; redirectTo: string }
  | { kind: 'login_started'; pending: false; provider: AuthProvider }
  | { kind: 'mfa_required'; pending: false; provider: AuthProvider; factors: AdminMfaFactor[] }
  | { kind: 'mfa_enrollment_required'; pending: false; provider: AuthProvider }
  | { kind: 'mfa_enrollment'; pending: false; provider: AuthProvider }
  | { kind: 'error'; pending: false; code: AdminInitializationErrorCode };

interface AdminAuthInitializationDependencies {
  initializeProvider(signal: AbortSignal): Promise<AuthProvider>;
  getMfaStepUpState(signal: AbortSignal): Promise<AdminMfaStepUpState>;
  isSsoEnabled(): boolean;
  isEnrollmentRoute(): boolean;
  onStateChange(state: AdminAuthInitializationState): void;
  timeoutMs?: number;
}

interface DeferredRedirectResult {
  commitRedirect?: (signal: AbortSignal) => Promise<void>;
  rollbackRedirect?: () => Promise<void>;
}

type PreparedRedirectState = Extract<AdminAuthInitializationState, { kind: 'redirect' }>
  & DeferredRedirectResult;
type PreparedInitializationState =
  | Exclude<AdminAuthInitializationState, { kind: 'redirect' }>
  | PreparedRedirectState;

function errorRecord(error: unknown): Record<string, unknown> | null {
  return typeof error === 'object' && error !== null
    ? error as Record<string, unknown>
    : null;
}

function initializationErrorCode(error: unknown): AdminInitializationErrorCode {
  const record = errorRecord(error);
  if (record?.code === 'request_timeout') return 'request_timeout';
  if (record?.code === 'request_aborted') return 'request_aborted';
  if (record?.statusCode === 401 || record?.status === 401) return 'authentication_required';
  if (record?.statusCode === 403 || record?.status === 403) return 'forbidden';
  if (record?.statusCode === 503 || record?.status === 503) return 'service_unavailable';
  return 'initialization_failed';
}

function isMfaRequired(authCheck: CheckResult): boolean {
  return authCheck.error?.name === 'admin_mfa_required';
}

function throwIfInitializationIsStale(
  attemptGeneration: number,
  currentGeneration: number,
  signal: AbortSignal,
): void {
  if (signal.aborted) signal.throwIfAborted();
  if (attemptGeneration !== currentGeneration) {
    const staleError = new Error('Admin authentication initialization was superseded');
    staleError.name = 'AbortError';
    throw staleError;
  }
}

async function mfaInitializationState(
  dependencies: AdminAuthInitializationDependencies,
  provider: AuthProvider,
  signal: AbortSignal,
): Promise<AdminAuthInitializationState> {
  const { factors } = await dependencies.getMfaStepUpState(signal);
  if (factors.length > 0)
    return { kind: 'mfa_required', pending: false, provider, factors };
  return dependencies.isEnrollmentRoute()
    ? { kind: 'mfa_enrollment', pending: false, provider }
    : { kind: 'mfa_enrollment_required', pending: false, provider };
}

async function unauthenticatedState(
  dependencies: AdminAuthInitializationDependencies,
  provider: AuthProvider,
  authCheck: CheckResult,
  signal: AbortSignal,
): Promise<PreparedInitializationState> {
  if (authCheck.error)
    return { kind: 'error', code: 'auth_check_failed', pending: false };
  if (!dependencies.isSsoEnabled())
    return { kind: 'error', code: 'sso_not_configured', pending: false };
  const loginResult = await provider.login({ signal });
  if (loginResult.success && !loginResult.redirectTo)
    return { kind: 'login_started', pending: false, provider };
  if (loginResult.redirectTo && loginResult.success !== false) {
    const deferredRedirect = loginResult as typeof loginResult & DeferredRedirectResult;
    return {
      kind: 'redirect',
      pending: false,
      provider,
      redirectTo: loginResult.redirectTo,
      ...(deferredRedirect.commitRedirect
        ? { commitRedirect: deferredRedirect.commitRedirect }
        : {}),
      ...(deferredRedirect.rollbackRedirect
        ? { rollbackRedirect: deferredRedirect.rollbackRedirect }
        : {}),
    };
  }
  return { kind: 'error', code: 'login_failed', pending: false };
}

async function initializationState(
  dependencies: AdminAuthInitializationDependencies,
  signal: AbortSignal,
): Promise<PreparedInitializationState> {
  const provider = await dependencies.initializeProvider(signal);
  const authCheck = await provider.check({ signal });
  if (authCheck.authenticated)
    return { kind: 'authenticated', pending: false, provider };
  if (isMfaRequired(authCheck))
    return mfaInitializationState(dependencies, provider, signal);
  return unauthenticatedState(dependencies, provider, authCheck, signal);
}

export function createAdminAuthInitializationController(
  dependencies: AdminAuthInitializationDependencies,
) {
  let generation = 0;
  let activeController: AbortController | null = null;
  let pendingAttempt: Promise<void> | null = null;

  function commit(attemptGeneration: number, state: AdminAuthInitializationState) {
    if (attemptGeneration === generation) dependencies.onStateChange(state);
  }

  async function commitPreparedRedirect(
    attemptGeneration: number,
    state: PreparedInitializationState,
    signal: AbortSignal,
  ): Promise<AdminAuthInitializationState> {
    if (state.kind !== 'redirect' || !state.commitRedirect) return state;
    throwIfInitializationIsStale(attemptGeneration, generation, signal);
    await state.commitRedirect(signal);
    if (attemptGeneration !== generation || signal.aborted) {
      await state.rollbackRedirect?.();
      throwIfInitializationIsStale(attemptGeneration, generation, signal);
    }
    const { commitRedirect: _commitRedirect, rollbackRedirect: _rollbackRedirect, ...committed } = state;
    return committed;
  }

  async function execute(attemptGeneration: number, controller: AbortController) {
    commit(attemptGeneration, { kind: 'checking', pending: true });
    try {
      const state = await runBoundedAdminRequest(
        async (signal) => commitPreparedRedirect(
          attemptGeneration,
          await initializationState(dependencies, signal),
          signal,
        ),
        { signal: controller.signal, timeoutMs: dependencies.timeoutMs },
      );
      commit(attemptGeneration, state);
    } catch (error) {
      commit(attemptGeneration, {
        kind: 'error',
        code: initializationErrorCode(error),
        pending: false,
      });
    }
  }

  function run(): Promise<void> {
    if (pendingAttempt) return pendingAttempt;
    const attemptGeneration = ++generation;
    const controller = new AbortController();
    activeController = controller;
    const attempt = execute(attemptGeneration, controller).finally(() => {
      if (pendingAttempt === attempt) pendingAttempt = null;
      if (activeController === controller) activeController = null;
    });
    pendingAttempt = attempt;
    return attempt;
  }

  function cancel() {
    generation += 1;
    activeController?.abort();
    activeController = null;
    pendingAttempt = null;
  }

  return Object.freeze({ run, retry: run, cancel });
}
