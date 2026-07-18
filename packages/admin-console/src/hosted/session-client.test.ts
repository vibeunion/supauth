// Bun executes this browser-bundle unit test directly; the Admin Svelte check does not include Bun's test globals.
// @ts-nocheck
import { describe, expect, mock, test } from 'bun:test';
import { AuthApiError, AuthError, AuthRetryableFetchError, type Session } from '@supabase/auth-js';
import {
  clearLegacyAccountAccessToken,
  clearLegacyAccountTokensFromUrl,
  createHostedAuthApi,
  LEGACY_ACCOUNT_ACCESS_TOKEN_STORAGE_KEY,
  type HostedAuthClient,
  type HostedFetch,
} from './session-client.js';

function session(accessToken: string): Session {
  return {
    access_token: accessToken,
    refresh_token: `refresh-${accessToken}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: 'user-1',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: new Date(0).toISOString(),
    },
  };
}

function client(overrides: Partial<HostedAuthClient> = {}): HostedAuthClient {
  const currentSession = session('access-old');
  return {
    signInWithPassword: mock(async () => ({ data: { user: currentSession.user, session: currentSession }, error: null })),
    getSession: mock(async () => ({ data: { session: currentSession }, error: null })),
    refreshSession: mock(async () => ({ data: { user: currentSession.user, session: currentSession }, error: null })),
    onAuthStateChange: mock(() => ({ data: { subscription: { id: 'test', unsubscribe() {} } } })),
    signOut: mock(async () => ({ error: null })),
    ...overrides,
  } as HostedAuthClient;
}

describe('hosted session client', () => {
  test('deletes legacy access-token remnants without reading or migrating them', () => {
    const sessionRemove = mock(() => {});
    const localRemove = mock(() => {});
    const sessionGet = mock(() => 'legacy-token');
    const localGet = mock(() => 'legacy-token');

    clearLegacyAccountAccessToken({
      sessionStorage: { removeItem: sessionRemove, getItem: sessionGet } as unknown as Storage,
      localStorage: { removeItem: localRemove, getItem: localGet } as unknown as Storage,
    });

    expect(sessionRemove).toHaveBeenCalledWith(LEGACY_ACCOUNT_ACCESS_TOKEN_STORAGE_KEY);
    expect(localRemove).toHaveBeenCalledWith(LEGACY_ACCOUNT_ACCESS_TOKEN_STORAGE_KEY);
    expect(sessionGet).not.toHaveBeenCalled();
    expect(localGet).not.toHaveBeenCalled();
  });

  test('removes sensitive auth tokens from query and fragment while preserving safe parameters', () => {
    const replaceState = mock(() => {});

    clearLegacyAccountTokensFromUrl({
      pathname: '/account/',
      search: '?section=profile&access_token=legacy-access&provider_token=provider-access',
      hash: '#refresh_token=legacy-refresh&provider_refresh_token=provider-refresh&token_type=bearer',
    }, { replaceState });

    expect(replaceState).toHaveBeenCalledWith(null, '', '/account/?section=profile#token_type=bearer');
  });

  test('does not rewrite an account URL that contains no sensitive auth token', () => {
    const replaceState = mock(() => {});

    clearLegacyAccountTokensFromUrl({
      pathname: '/account.html',
      search: '?section=profile',
      hash: '#security',
    }, { replaceState });

    expect(replaceState).not.toHaveBeenCalled();
  });

  test('retries one 401 with a refreshed token while preserving the cloned request', async () => {
    const refreshedSession = session('access-new');
    const authClient = client({
      refreshSession: mock(async () => ({ data: { user: refreshedSession.user, session: refreshedSession }, error: null })),
    });
    const requests: Array<{ authorization: string | null; body: string; trace: string | null; aborted: boolean }> = [];
    const fetchImpl = mock(async (request: Request) => {
      requests.push({
        authorization: request.headers.get('authorization'),
        body: await request.text(),
        trace: request.headers.get('x-trace-id'),
        aborted: request.signal.aborted,
      });
      if (requests.length === 1) controller.abort();
      return new Response(null, { status: requests.length === 1 ? 401 : 200 });
    });
    const controller = new AbortController();
    const api = createHostedAuthApi(authClient, fetchImpl as unknown as HostedFetch);

    const response = await api.authenticatedFetch('https://auth.example.test/v1/public/account/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-trace-id': 'trace-1' },
      body: JSON.stringify({ data: { name: 'Updated' } }),
      signal: controller.signal,
    });

    expect(response.status).toBe(200);
    expect(authClient.refreshSession).toHaveBeenCalledTimes(1);
    expect(requests).toEqual([
      { authorization: 'Bearer access-old', body: '{"data":{"name":"Updated"}}', trace: 'trace-1', aborted: false },
      { authorization: 'Bearer access-new', body: '{"data":{"name":"Updated"}}', trace: 'trace-1', aborted: true },
    ]);
  });

  test('does not refresh a forbidden response', async () => {
    const authClient = client();
    const fetchImpl = mock(async () => new Response(null, { status: 403 }));
    const api = createHostedAuthApi(authClient, fetchImpl as unknown as HostedFetch);

    const response = await api.authenticatedFetch('https://auth.example.test/v1/public/account/me');

    expect(response.status).toBe(403);
    expect(authClient.refreshSession).not.toHaveBeenCalled();
    expect(authClient.signOut).not.toHaveBeenCalled();
  });

  test('keeps the local session when refresh fails with a retryable 503', async () => {
    const authClient = client({
      refreshSession: mock(async () => ({
        data: { user: null, session: null },
        error: new AuthRetryableFetchError('Service temporarily unavailable', 503),
      })),
    });
    const api = createHostedAuthApi(
      authClient,
      mock(async () => new Response(null, { status: 401 })) as unknown as HostedFetch,
    );

    await expect(api.authenticatedFetch('https://auth.example.test/v1/public/account/me'))
      .rejects.toMatchObject({ code: 'refresh_retryable' });
    expect(authClient.signOut).not.toHaveBeenCalled();
  });

  test('keeps the local session when refresh throws an auth-js retryable fetch error', async () => {
    const authClient = client({
      refreshSession: mock(async () => {
        throw new AuthRetryableFetchError('Network unavailable', 0);
      }),
    });
    const api = createHostedAuthApi(
      authClient,
      mock(async () => new Response(null, { status: 401 })) as unknown as HostedFetch,
    );

    await expect(api.authenticatedFetch('https://auth.example.test/v1/public/account/me'))
      .rejects.toMatchObject({ code: 'refresh_retryable' });
    expect(authClient.signOut).not.toHaveBeenCalled();
  });

  test('does not misclassify an unexpected TypeError as a retryable auth-js fetch error', async () => {
    const signOut = mock(async () => ({ error: null }));
    const authClient = client({
      refreshSession: mock(async () => {
        throw new TypeError('Load failed');
      }),
      signOut,
    });
    const api = createHostedAuthApi(
      authClient,
      mock(async () => new Response(null, { status: 401 })) as unknown as HostedFetch,
    );

    await expect(api.authenticatedFetch('https://auth.example.test/v1/public/account/me'))
      .rejects.toMatchObject({ code: 'refresh_failed' });
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  test('keeps the local session when the auth-js refresh lock times out', async () => {
    const lockError = Object.assign(new Error('Lock acquire timed out'), {
      isAcquireTimeout: true,
    });
    const authClient = client({
      refreshSession: mock(async () => {
        throw lockError;
      }),
    });
    const api = createHostedAuthApi(
      authClient,
      mock(async () => new Response(null, { status: 401 })) as unknown as HostedFetch,
    );

    await expect(api.authenticatedFetch('https://auth.example.test/v1/public/account/me'))
      .rejects.toMatchObject({ code: 'refresh_retryable' });
    expect(authClient.signOut).not.toHaveBeenCalled();
  });

  test('clears the local session when refresh token is terminally invalid', async () => {
    const signOut = mock(async () => ({ error: null }));
    const authClient = client({
      refreshSession: mock(async () => ({
        data: { user: null, session: null },
        error: new AuthApiError('Invalid refresh token', 400, 'refresh_token_not_found'),
      })),
      signOut,
    });
    const api = createHostedAuthApi(
      authClient,
      mock(async () => new Response(null, { status: 401 })) as unknown as HostedFetch,
    );

    await expect(api.authenticatedFetch('https://auth.example.test/v1/public/account/me'))
      .rejects.toMatchObject({ code: 'refresh_failed' });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  test('deduplicates concurrent 401 refreshes', async () => {
    const refreshedSession = session('access-new');
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const refreshSession = mock(async () => {
      await refreshGate;
      return { data: { user: refreshedSession.user, session: refreshedSession }, error: null };
    });
    const authClient = client({ refreshSession });
    const fetchImpl = mock(async (request: Request) => new Response(null, {
      status: request.headers.get('authorization') === 'Bearer access-old' ? 401 : 200,
    }));
    const api = createHostedAuthApi(authClient, fetchImpl as unknown as HostedFetch);

    const first = api.authenticatedFetch('https://auth.example.test/v1/public/account/me');
    const second = api.authenticatedFetch('https://auth.example.test/v1/public/account/sessions');
    await Promise.resolve();
    await Promise.resolve();
    releaseRefresh();

    const responses = await Promise.all([first, second]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  test('clears the local session after the retried request also returns 401', async () => {
    const refreshedSession = session('access-new');
    const signOut = mock(async () => ({ error: null }));
    const authClient = client({
      refreshSession: mock(async () => ({ data: { user: refreshedSession.user, session: refreshedSession }, error: null })),
      signOut,
    });
    const api = createHostedAuthApi(
      authClient,
      mock(async () => new Response(null, { status: 401 })) as unknown as HostedFetch,
    );

    const response = await api.authenticatedFetch('https://auth.example.test/v1/public/account/me');

    expect(response.status).toBe(401);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  test('fails explicitly before fetch when a consumed request cannot be replayed', async () => {
    const authClient = client();
    const fetchImpl = mock(async () => new Response(null, { status: 200 }));
    const api = createHostedAuthApi(authClient, fetchImpl as unknown as HostedFetch);
    const request = new Request('https://auth.example.test/v1/public/account/profile', {
      method: 'PATCH',
      body: 'used body',
    });
    await request.text();

    await expect(api.authenticatedFetch(request)).rejects.toMatchObject({ code: 'request_not_replayable' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('falls back to local sign-out when remote revocation fails', async () => {
    const remoteError = new AuthError('GoTrue unavailable', 503, 'service_unavailable');
    const signOut = mock(async ({ scope }: { scope?: string } = {}) => ({
      error: scope === 'global' ? remoteError : null,
    }));
    const api = createHostedAuthApi(client({ signOut: signOut as HostedAuthClient['signOut'] }));

    const result = await api.signOut();

    expect(signOut).toHaveBeenNthCalledWith(1, { scope: 'global' });
    expect(signOut).toHaveBeenNthCalledWith(2, { scope: 'local' });
    expect(result.error).toMatchObject({ code: 'remote_sign_out_failed' });
    expect(result.error?.message).toContain('本地已退出，服务端撤销失败');
  });
});
