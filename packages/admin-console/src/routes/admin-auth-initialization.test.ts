// Bun runs this module directly; the Svelte check does not include Bun's test globals.
// @ts-nocheck
import { describe, expect, mock, test } from 'bun:test';
import { createAdminAuthInitializationController } from './admin-auth-initialization.js';

function deferredRequest() {
  let resolveRequest;
  let rejectRequest;
  const promise = new Promise((resolve, reject) => {
    resolveRequest = resolve;
    rejectRequest = reject;
  });
  return { promise, resolve: resolveRequest, reject: rejectRequest };
}

function providerWith(authCheck, loginResult = {}) {
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
    },
    checkCount: () => checkCount,
    loginCount: () => loginCount,
  };
}

function controllerHarness(overrides = {}) {
  const states = [];
  const authenticatedProvider = providerWith({ authenticated: true });
  const dependencies = {
    initializeProvider: async () => authenticatedProvider.provider,
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

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(message);
}

async function flushMicrotasks() {
  for (let attempt = 0; attempt < 12; attempt += 1) await Promise.resolve();
}

describe('admin auth initialization controller', () => {
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
    const slowInitialization = deferredRequest();
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
    const initialization = deferredRequest();
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
    await Promise.resolve();
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
    [401, 'authentication_required'],
    [403, 'forbidden'],
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
    const storageValues = new Map();
    const discoveryRequests = [];
    const tokenBodies = [];
    let currentHref = 'https://admin.example.test/admin';
    const location = {
      get href() { return currentHref; },
      set href(value) { currentHref = new URL(String(value), currentHref).href; },
      get origin() { return new URL(currentHref).origin; },
      get pathname() { return new URL(currentHref).pathname; },
      assign(value) { currentHref = new URL(String(value), currentHref).href; },
    };
    const browserWindow = {
      document: {},
      navigator: {
        locks: { request: async (_name, operation) => operation() },
      },
      location,
      history: { replaceState: () => undefined },
      sessionStorage: {
        getItem: (key) => storageValues.get(key) ?? null,
        setItem: (key, value) => storageValues.set(key, value),
        removeItem: (key) => storageValues.delete(key),
      },
    };
    const fetcher = mock(async (input, init = {}) => {
      const requestUrl = new URL(
        input instanceof Request ? input.url : String(input),
        location.href,
      );
      if (requestUrl.pathname === '/api/v1/public/admin-sso-config') {
        return Response.json({
          enabled: true,
          issuer: 'https://issuer.example.test',
          client_id: 'admin-client',
          redirect_uri: 'https://admin.example.test/admin',
        });
      }
      if (requestUrl.pathname === '/.well-known/openid-configuration') {
        const response = deferredRequest();
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
        return Response.json({ id: 'admin-1' });
      }
      return Response.json({ code: 'not_found' }, { status: 404 });
    });
    globalThis.window = browserWindow;
    globalThis.Request = class BrowserRequest extends OriginalRequest {
      constructor(input, init) {
        super(typeof input === 'string' && input.startsWith('/')
          ? new URL(input, location.href)
          : input, init);
      }
    };
    globalThis.fetch = fetcher;

    try {
      const authModule = await import('../lib/providers/auth.js');
      const dependencies = {
        initializeProvider: (signal) => authModule.initializeAdminAuthProvider({ signal }),
        getMfaStepUpState: (signal) => authModule.getAdminMfaStepUpState({ signal }),
        isSsoEnabled: () => authModule.adminSsoEnabled,
        isEnrollmentRoute: () => false,
      };

      const cancelledStates = [];
      const cancelled = createAdminAuthInitializationController({
        ...dependencies,
        onStateChange: (state) => cancelledStates.push(state),
      });
      const cancelledAttempt = cancelled.run();
      await waitFor(() => discoveryRequests.length === 1, 'cancel probe did not start discovery');
      cancelled.cancel();
      discoveryRequests[0].response.resolve(Response.json({
        authorization_endpoint: 'https://idp.example.test/oauth/authorize',
        token_endpoint: 'https://issuer.example.test/oauth/token',
        userinfo_endpoint: 'https://issuer.example.test/userinfo',
      }));
      await cancelledAttempt;
      await flushMicrotasks();

      expect(discoveryRequests[0].signal).toBeInstanceOf(AbortSignal);
      expect(discoveryRequests[0].signal.aborted).toBe(true);
      expect(location.href).toBe('https://admin.example.test/admin');
      expect(storageValues.has('supaoauth_admin_sso_pkce_verifier')).toBe(false);
      expect(storageValues.has('supaoauth_admin_sso_state')).toBe(false);
      expect(cancelledStates.map((state) => state.kind)).toEqual(['checking']);

      const timeoutStates = [];
      const timedOut = createAdminAuthInitializationController({
        ...dependencies,
        timeoutMs: 5,
        onStateChange: (state) => timeoutStates.push(state),
      });
      const timeoutAttempt = timedOut.run();
      await waitFor(() => discoveryRequests.length === 2, 'timeout probe did not start discovery');
      await timeoutAttempt;
      discoveryRequests[1].response.resolve(Response.json({
        authorization_endpoint: 'https://idp.example.test/oauth/authorize',
        token_endpoint: 'https://issuer.example.test/oauth/token',
        userinfo_endpoint: 'https://issuer.example.test/userinfo',
      }));
      await flushMicrotasks();

      expect(discoveryRequests[1].signal).toBeInstanceOf(AbortSignal);
      expect(discoveryRequests[1].signal.aborted).toBe(true);
      expect(timeoutStates.at(-1)).toEqual({
        kind: 'error',
        code: 'request_timeout',
        pending: false,
      });
      expect(location.href).toBe('https://admin.example.test/admin');
      expect(storageValues.has('supaoauth_admin_sso_pkce_verifier')).toBe(false);
      expect(storageValues.has('supaoauth_admin_sso_state')).toBe(false);

      const recoveredStates = [];
      const recovered = createAdminAuthInitializationController({
        ...dependencies,
        onStateChange: (state) => recoveredStates.push(state),
      });
      const recoveredAttempt = recovered.run();
      await waitFor(() => discoveryRequests.length === 3, 'recovery probe did not start discovery');
      discoveryRequests[2].response.resolve(Response.json({
        authorization_endpoint: 'https://idp.example.test/oauth/authorize',
        token_endpoint: 'https://issuer.example.test/oauth/token',
        userinfo_endpoint: 'https://issuer.example.test/userinfo',
      }));
      await recoveredAttempt;

      const redirectState = recoveredStates.at(-1);
      expect(redirectState).toMatchObject({ kind: 'redirect', pending: false });
      expect(location.href).toBe('https://admin.example.test/admin');
      const committedVerifier = storageValues.get('supaoauth_admin_sso_pkce_verifier');
      expect(committedVerifier).toBeTruthy();
      expect(storageValues.get('supaoauth_admin_sso_state')).toBeTruthy();
      const authorizeUrl = new URL(redirectState.redirectTo);
      expect(authorizeUrl.origin).toBe('https://idp.example.test');
      expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');
      expect(authorizeUrl.searchParams.get('state')).toBe(
        storageValues.get('supaoauth_admin_sso_state'),
      );

      location.href = `https://admin.example.test/admin?code=safe-code&state=${authorizeUrl.searchParams.get('state')}`;
      await expect(redirectState.provider.check({})).resolves.toEqual({ authenticated: true });
      expect(tokenBodies).toHaveLength(1);
      expect(tokenBodies[0].get('code_verifier')).toBe(committedVerifier);
      expect(storageValues.has('supaoauth_admin_sso_pkce_verifier')).toBe(false);
      expect(storageValues.has('supaoauth_admin_sso_state')).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.Request = OriginalRequest;
      globalThis.window = originalWindow;
    }
  });
});
