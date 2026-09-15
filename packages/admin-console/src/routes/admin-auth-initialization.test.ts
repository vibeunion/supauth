import { enabledSsoConfig, adminIdentityFixture, deferredRequest, runLockOperation } from '../lib/providers/auth-fixtures';
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { AuthProvider, AuthActionResult, CheckResult } from '@svadmin/core';
import { createAdminAuthInitializationController, type AdminAuthInitializationState } from './admin-auth-initialization.js';
import { resetAdminAuthRuntimeForTests } from '../lib/providers/auth.js';

function providerWith(authCheck: CheckResult, loginResult: AuthActionResult = { success: false }) {
  let checkCount = 0;
  let loginCount = 0;
  return {
    provider: {
      check: async () => {
        checkCount += 1;
        return authCheck;
      },
      login: async () => {
        loginCount += 1;
        return loginResult;
      },
      logout: async () => { throw new Error('Unexpected logout in initialization probe'); },
      getIdentity: async () => { throw new Error('Unexpected identity read in initialization probe'); },
    },
    checkCount: () => checkCount,
    loginCount: () => loginCount,
  };
}

type ControllerDependencies = Parameters<typeof createAdminAuthInitializationController>[0];

function controllerHarness(overrides: Partial<ControllerDependencies> = {}) {
  const states: AdminAuthInitializationState[] = [];
  const authenticatedProvider = providerWith({ authenticated: true });
  const dependencies: ControllerDependencies = {
    initializeProvider: async () => authenticatedProvider.provider,
    prepareRetry: async () => {},
    getMfaStepUpState: async () => ({ factors: [] }),
    isSsoEnabled: () => true,
    isEnrollmentRoute: () => false,
    onStateChange: (state) => states.push(state),
    ...overrides,
  };
  return {
    controller: createAdminAuthInitializationController(dependencies),
    states,
    authenticatedProvider,
  };
}

async function waitFor(predicate: () => boolean, message: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(message);
}

async function flushMicrotasks() {
  for (let attempt = 0; attempt < 12; attempt += 1) await Promise.resolve();
}

beforeEach(() => {
  resetAdminAuthRuntimeForTests();
});

afterEach(() => {
  resetAdminAuthRuntimeForTests();
});

describe('admin auth initialization controller', () => {
  test.each([
    { commitRedirect: 42 },
    { rollbackRedirect: 'not-callable' },
    { commitRedirect: async () => 'invalid-result' },
  ])('rejects invalid deferred redirect hooks before navigation', async (hooks) => {
    const login = providerWith({ authenticated: false }, {
      success: true,
      redirectTo: 'https://issuer.example.test/authorize',
      ...hooks,
    });
    const { controller, states } = controllerHarness({
      initializeProvider: async () => login.provider,
    });
    await controller.run();
    expect(states.at(-1)).toEqual({
      kind: 'error', code: 'initialization_failed', pending: false,
    });
    expect(states.some((state) => state.kind === 'redirect')).toBe(false);
  });

  test('prepares callback recovery only for an explicit retry', async () => {
    let retryPreparationCount = 0;
    const { controller, states } = controllerHarness({
      prepareRetry: async () => {
        retryPreparationCount += 1;
      },
    });

    await controller.run();
    expect(retryPreparationCount).toBe(0);

    await controller.retry();
    expect(retryPreparationCount).toBe(1);
    expect(states.at(-1)).toMatchObject({ kind: 'authenticated' });
  });

  test('classifies retry preparation failures without exposing their details', async () => {
    const { controller, states } = controllerHarness({
      prepareRetry: async () => {
        throw new Error('https://issuer.example.test/?client_secret=unsafe');
      },
    });

    await controller.retry();
    expect(states.at(-1)).toEqual({
      kind: 'error',
      code: 'initialization_failed',
      pending: false,
    });
    expect(JSON.stringify(states)).not.toContain('client_secret');
  });

  test.each([
    'State mismatch',
    'Token exchange failed: upstream-private-detail',
  ])('classifies OAuth callback failure safely: %s', async (upstreamMessage) => {
    const callbackFailureProvider = providerWith({
      authenticated: false,
      error: { message: upstreamMessage },
    });
    const { controller, states } = controllerHarness({
      initializeProvider: async () => callbackFailureProvider.provider,
    });

    await controller.run();
    expect(states.at(-1)).toEqual({
      kind: 'error',
      code: 'auth_check_failed',
      pending: false,
    });
    expect(JSON.stringify(states)).not.toContain(upstreamMessage);
  });

  test('recovers from a 503 on retry without a page reload', async () => {
    const authenticatedProvider = providerWith({ authenticated: true });
    let initializationCount = 0;
    const { controller, states } = controllerHarness({
      initializeProvider: async () => {
        initializationCount += 1;
        if (initializationCount === 1) {
          throw Object.assign(
            new Error('https://private.example/?token=secret'),
            { statusCode: 503 },
          );
        }
        return authenticatedProvider.provider;
      },
    });

    await controller.run();
    expect(states.at(-1)).toEqual({
      kind: 'error',
      code: 'service_unavailable',
      pending: false,
    });

    await controller.retry();
    expect(states.at(-1)).toMatchObject({
      kind: 'authenticated',
      pending: false,
    });
    expect(initializationCount).toBe(2);
    expect(JSON.stringify(states)).not.toContain('private.example');
    expect(JSON.stringify(states)).not.toContain('token=secret');
  });

  test('ignores a first slow failure after a replacement attempt succeeds', async () => {
    const slowInitialization = deferredRequest<AuthProvider>();
    const authenticatedProvider = providerWith({ authenticated: true });
    let initializationCount = 0;
    const { controller, states } = controllerHarness({
      initializeProvider: async () => {
        initializationCount += 1;
        if (initializationCount === 1) return slowInitialization.promise;
        return authenticatedProvider.provider;
      },
    });

    const staleAttempt = controller.run();
    await Promise.resolve();
    controller.cancel();
    await controller.run();
    expect(states.at(-1)).toMatchObject({ kind: 'authenticated' });

    slowInitialization.reject(new Error('stale secret failure'));
    await staleAttempt;
    expect(states.at(-1)).toMatchObject({ kind: 'authenticated' });
    expect(JSON.stringify(states)).not.toContain('stale secret failure');
  });

  test('deduplicates rapid retry while initialization is pending', async () => {
    const initialization = deferredRequest<AuthProvider>();
    const loginProvider = providerWith(
      { authenticated: false },
      { success: true, redirectTo: '/admin/login' },
    );
    let initializationCount = 0;
    const { controller } = controllerHarness({
      initializeProvider: async () => {
        initializationCount += 1;
        return initialization.promise;
      },
    });

    const firstRetry = controller.retry();
    const secondRetry = controller.retry();
    expect(secondRetry).toBe(firstRetry);
    await waitFor(() => initializationCount === 1, 'deduplicated initialization did not start');
    expect(initializationCount).toBe(1);

    initialization.resolve(loginProvider.provider);
    await Promise.all([firstRetry, secondRetry]);
    expect(initializationCount).toBe(1);
    expect(loginProvider.checkCount()).toBe(1);
    expect(loginProvider.loginCount()).toBe(1);
  });

  test('commits verified MFA factors without classifying them as timeout', async () => {
    const mfaProvider = providerWith({
      authenticated: false,
      error: { name: 'admin_mfa_required', message: 'MFA required' },
    });
    const { controller, states } = controllerHarness({
      initializeProvider: async () => mfaProvider.provider,
      getMfaStepUpState: async () => ({
        factors: [{ id: 'factor-1', label: 'Authenticator' }],
      }),
    });

    await controller.run();
    expect(states.at(-1)).toMatchObject({
      kind: 'mfa_required',
      factors: [{ id: 'factor-1', label: 'Authenticator' }],
      pending: false,
    });
  });

  test.each([
    [false, 'mfa_enrollment_required'],
    [true, 'mfa_enrollment'],
  ])('commits the MFA enrollment state for route=%s', async (enrollmentRoute, expectedKind) => {
    const mfaProvider = providerWith({
      authenticated: false,
      error: { name: 'admin_mfa_required', message: 'MFA required' },
    });
    const { controller, states } = controllerHarness({
      initializeProvider: async () => mfaProvider.provider,
      isEnrollmentRoute: () => enrollmentRoute,
    });

    await controller.run();
    expect(states.at(-1)).toMatchObject({
      kind: expectedKind,
      pending: false,
    });
  });

  test('maps an MFA-state failure to a safe retryable error', async () => {
    const mfaProvider = providerWith({
      authenticated: false,
      error: { name: 'admin_mfa_required', message: 'MFA required' },
    });
    const { controller, states } = controllerHarness({
      initializeProvider: async () => mfaProvider.provider,
      getMfaStepUpState: async () => {
        throw Object.assign(new Error('raw MFA provider failure'), {
          statusCode: 503,
        });
      },
    });

    await controller.run();
    expect(states.at(-1)).toEqual({
      kind: 'error',
      code: 'service_unavailable',
      pending: false,
    });
    expect(JSON.stringify(states)).not.toContain('raw MFA provider failure');
  });

  test.each([
    [401, 'authentication_required'] as const,
    [403, 'forbidden'] as const,
  ])('does not misclassify HTTP %s as timeout', async (statusCode, expectedCode) => {
    const { controller, states } = controllerHarness({
      initializeProvider: async () => {
        throw Object.assign(new Error('raw upstream detail'), { statusCode });
      },
    });

    await controller.run();
    expect(states.at(-1)).toEqual({
      kind: 'error',
      code: expectedCode,
      pending: false,
    });
  });

  test('keeps a provider-owned successful login out of the login_failed state', async () => {
    const loginProvider = providerWith(
      { authenticated: false },
      { success: true },
    );
    const { controller, states } = controllerHarness({
      initializeProvider: async () => loginProvider.provider,
    });

    await controller.run();

    expect(states.at(-1)).toMatchObject({
      kind: 'login_started',
      pending: false,
    });
    expect(states.some((state) => state.kind === 'error')).toBe(false);
  });

  test('cancels real SSO on unmount and timeout, then commits only the current generation', async () => {
    const originalFetch = globalThis.fetch;
    const OriginalRequest = globalThis.Request;
    const originalWindow = globalThis.window;
    const storageValues = new Map<string, string>();
    const discoveryRequests: { response: ReturnType<typeof deferredRequest<Response>>; signal: AbortSignal }[] = [];
    const tokenBodies: URLSearchParams[] = [];
    let currentHref = 'https://admin.example.test/admin';
    const location = {
      get href() { return currentHref; },
      set href(value) { currentHref = new URL(String(value), currentHref).href; },
      get origin() { return new URL(currentHref).origin; },
      get pathname() { return new URL(currentHref).pathname; },
      assign(value: string | URL) { currentHref = new URL(String(value), currentHref).href; },
    };
    const browserWindow = {
      document: {},
      navigator: {
        locks: { request: runLockOperation },
      },
      location,
      history: { replaceState: () => undefined },
      sessionStorage: {
        getItem: (key: string) => storageValues.get(key) ?? null,
        setItem: (key: string, value: string) => { storageValues.set(key, value); },
        removeItem: (key: string) => { storageValues.delete(key); },
      },
    };
    const fetcher = mock(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const requestUrl = new URL(
        input instanceof Request ? input.url : String(input),
        location.href,
      );
      if (requestUrl.pathname === '/api/v1/public/admin-sso-config') {
        return Response.json({
          ...enabledSsoConfig,
        });
      }
      if (requestUrl.pathname === '/.well-known/openid-configuration') {
        const response = deferredRequest<Response>();
        if (!init.signal) throw new Error('Expected discovery abort signal');
        discoveryRequests.push({ response, signal: init.signal });
        return response.promise;
      }
      if (requestUrl.pathname === '/oauth/token') {
        tokenBodies.push(new URLSearchParams(String(init.body)));
        return Response.json({
          access_token: 'safe-access-token',
          refresh_token: 'safe-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }
      if (requestUrl.pathname === '/api/v1/auth/identity') {
        return Response.json(adminIdentityFixture);
      }
      return Response.json({ code: 'not_found' }, { status: 404 });
    });
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: browserWindow });
    globalThis.Request = class BrowserRequest extends OriginalRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(typeof input === 'string' && input.startsWith('/')
          ? new URL(input, location.href)
          : input, init);
      }
    };
    globalThis.fetch = (fetcher);

    try {
      const authModule = await import('../lib/providers/auth.js');
      const dependencies = {
        initializeProvider: (signal: AbortSignal) => authModule.initializeAdminAuthProvider({ signal }),
        prepareRetry: (signal: AbortSignal) => authModule.prepareAdminAuthCallbackRetry({ signal }),
        getMfaStepUpState: (signal: AbortSignal) => authModule.getAdminMfaStepUpState({ signal }),
        isSsoEnabled: () => authModule.adminSsoEnabled,
        isEnrollmentRoute: () => false,
      };

      const cancelledStates: AdminAuthInitializationState[] = [];
      const cancelled = createAdminAuthInitializationController({
        ...dependencies,
        onStateChange: (state) => cancelledStates.push(state),
      });
      const cancelledAttempt = cancelled.run();
      await waitFor(() => discoveryRequests.length === 1, 'cancel probe did not start discovery');
      cancelled.cancel();
      const cancelledDiscovery = discoveryRequests[0];
      if (!cancelledDiscovery) throw new Error('Expected cancelled discovery request');
      cancelledDiscovery.response.resolve(Response.json({
        authorization_endpoint: 'https://idp.example.test/oauth/authorize',
        token_endpoint: 'https://issuer.example.test/oauth/token',
        userinfo_endpoint: 'https://issuer.example.test/userinfo',
      }));
      await cancelledAttempt;
      await flushMicrotasks();

      expect(cancelledDiscovery.signal).toBeInstanceOf(AbortSignal);
      expect(cancelledDiscovery.signal.aborted).toBe(true);
      expect(location.href).toBe('https://admin.example.test/admin');
      expect(storageValues.has('supaoauth_admin_sso_pkce_verifier')).toBe(false);
      expect(storageValues.has('supaoauth_admin_sso_state')).toBe(false);
      expect(cancelledStates.map((state) => state.kind)).toEqual(['checking']);

      const timeoutStates: AdminAuthInitializationState[] = [];
      const timedOut = createAdminAuthInitializationController({
        ...dependencies,
        timeoutMs: 5,
        onStateChange: (state) => timeoutStates.push(state),
      });
      const timeoutAttempt = timedOut.run();
      await waitFor(() => discoveryRequests.length === 2, 'timeout probe did not start discovery');
      await timeoutAttempt;
      const timedOutDiscovery = discoveryRequests[1];
      if (!timedOutDiscovery) throw new Error('Expected timed-out discovery request');
      timedOutDiscovery.response.resolve(Response.json({
        authorization_endpoint: 'https://idp.example.test/oauth/authorize',
        token_endpoint: 'https://issuer.example.test/oauth/token',
        userinfo_endpoint: 'https://issuer.example.test/userinfo',
      }));
      await flushMicrotasks();

      expect(timedOutDiscovery.signal).toBeInstanceOf(AbortSignal);
      expect(timedOutDiscovery.signal.aborted).toBe(true);
      expect(timeoutStates.at(-1)).toEqual({
        kind: 'error',
        code: 'request_timeout',
        pending: false,
      });
      expect(location.href).toBe('https://admin.example.test/admin');
      expect(storageValues.has('supaoauth_admin_sso_pkce_verifier')).toBe(false);
      expect(storageValues.has('supaoauth_admin_sso_state')).toBe(false);

      const recoveredStates: AdminAuthInitializationState[] = [];
      const recovered = createAdminAuthInitializationController({
        ...dependencies,
        onStateChange: (state) => recoveredStates.push(state),
      });
      const recoveredAttempt = recovered.run();
      await waitFor(() => discoveryRequests.length === 3, 'recovery probe did not start discovery');
      const recoveredDiscovery = discoveryRequests[2];
      if (!recoveredDiscovery) throw new Error('Expected recovered discovery request');
      recoveredDiscovery.response.resolve(Response.json({
        authorization_endpoint: 'https://idp.example.test/oauth/authorize',
        token_endpoint: 'https://issuer.example.test/oauth/token',
        userinfo_endpoint: 'https://issuer.example.test/userinfo',
      }));
      await recoveredAttempt;

      const redirectState = recoveredStates.at(-1);
      expect(redirectState).toMatchObject({ kind: 'redirect', pending: false });
      if (redirectState?.kind !== 'redirect') throw new Error('Expected recovered redirect');
      expect(location.href).toBe('https://admin.example.test/admin');
      const committedVerifier = storageValues.get('supaoauth_admin_sso_pkce_verifier');
      expect(committedVerifier).toBeTruthy();
      const committedState = storageValues.get('supaoauth_admin_sso_state');
      expect(committedState).toBeTruthy();
      if (!committedVerifier || !committedState) throw new Error('Expected committed PKCE state');
      const authorizeUrl = new URL(redirectState.redirectTo);
      expect(authorizeUrl.origin).toBe('https://idp.example.test');
      expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');
      expect(authorizeUrl.searchParams.get('state')).toBe(
        committedState,
      );

      location.href = `https://admin.example.test/admin?code=safe-code&state=${authorizeUrl.searchParams.get('state')}`;
      await expect(redirectState.provider.check({})).resolves.toEqual({ authenticated: true });
      expect(tokenBodies).toHaveLength(1);
      const tokenBody = tokenBodies[0];
      expect(tokenBody).toBeDefined();
      if (!tokenBody) throw new Error('Expected token request');
      expect(tokenBody.get('code_verifier')).toBe(committedVerifier);
      expect(storageValues.has('supaoauth_admin_sso_pkce_verifier')).toBe(false);
      expect(storageValues.has('supaoauth_admin_sso_state')).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.Request = OriginalRequest;
      Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: originalWindow });
    }
  });
});
