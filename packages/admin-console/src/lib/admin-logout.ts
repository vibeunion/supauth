import type { AuthActionResult } from '@svadmin/core';

export interface AdminLogoutState {
  pending: boolean;
  error: string;
}

interface AdminLogoutControllerOptions {
  initializeProvider: () => Promise<unknown>;
  logout: () => Promise<AuthActionResult>;
  browserOrigin: () => string;
  navigate: (url: string) => void;
  failureMessage: () => string;
  unsafeRedirectMessage: () => string;
  onStateChange: (state: AdminLogoutState) => void;
}

function sameOriginRedirect(redirectTo: string, browserOrigin: string): string | null {
  try {
    const target = new URL(redirectTo, browserOrigin);
    if (target.origin !== browserOrigin || target.username || target.password) return null;
    return target.href;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown, fallback: () => string): string {
  return error instanceof Error && error.message ? error.message : fallback();
}

export function createAdminLogoutController(options: AdminLogoutControllerOptions) {
  let state: AdminLogoutState = { pending: false, error: '' };

  function emitState() {
    options.onStateChange({ ...state });
  }

  function applyResult(result: AuthActionResult) {
    if (!result.success) {
      state.error = result.error?.message || options.failureMessage();
      return;
    }
    if (!result.redirectTo) return;
    const redirectUrl = sameOriginRedirect(result.redirectTo, options.browserOrigin());
    if (!redirectUrl) {
      state.error = options.unsafeRedirectMessage();
      return;
    }
    options.navigate(redirectUrl);
  }

  return Object.freeze({
    async run(): Promise<void> {
      if (state.pending) return;
      state = { pending: true, error: '' };
      emitState();
      try {
        await options.initializeProvider();
        applyResult(await options.logout());
      } catch (error) {
        state.error = errorMessage(error, options.failureMessage);
      } finally {
        state.pending = false;
        emitState();
      }
    },
  });
}
