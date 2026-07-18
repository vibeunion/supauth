import {
  AuthError,
  GoTrueClient,
  isAuthRetryableFetchError,
  type AuthChangeEvent,
  type Session,
  type SignInWithPasswordCredentials,
  type Subscription,
} from '@supabase/auth-js';

export const HOSTED_AUTH_STORAGE_KEY = 'supaoauth.hosted.auth.session';
export const LEGACY_ACCOUNT_ACCESS_TOKEN_STORAGE_KEY = 'supaoauth.account.access_token';
const SENSITIVE_AUTH_URL_PARAMS = [
  'access_token',
  'refresh_token',
  'provider_token',
  'provider_refresh_token',
] as const;

export class HostedAuthError extends Error {
  constructor(
    message: string,
    public readonly code: 'request_not_replayable' | 'session_read_failed' | 'session_missing' | 'refresh_retryable' | 'refresh_failed',
  ) {
    super(message);
    this.name = 'HostedAuthError';
  }
}

export function clearLegacyAccountAccessToken(
  target: Pick<Window, 'sessionStorage' | 'localStorage'>,
): void {
  for (const storageName of ['sessionStorage', 'localStorage'] as const) {
    try {
      target[storageName].removeItem(LEGACY_ACCOUNT_ACCESS_TOKEN_STORAGE_KEY);
    } catch {
      // 隐私模式下 Storage 可能不可用；旧 token 只删除，不读取也不迁移。
    }
  }
}

function sanitizeAuthUrlParams(rawParams: string): { encoded: string; removedSensitiveParam: boolean } {
  const params = new URLSearchParams(rawParams.replace(/^[?#]/, ''));
  let removedSensitiveParam = false;
  for (const key of SENSITIVE_AUTH_URL_PARAMS) {
    if (params.has(key)) removedSensitiveParam = true;
    params.delete(key);
  }
  return { encoded: params.toString(), removedSensitiveParam };
}

export function clearLegacyAccountTokensFromUrl(
  location: Pick<Location, 'pathname' | 'search' | 'hash'>,
  history: Pick<History, 'replaceState'>,
): void {
  const normalizedPath = location.pathname.replace(/\/+$/, '') || '/';
  if (normalizedPath !== '/account' && normalizedPath !== '/account.html') return;
  const safeQuery = sanitizeAuthUrlParams(location.search);
  const safeFragment = sanitizeAuthUrlParams(location.hash);
  if (!safeQuery.removedSensitiveParam && !safeFragment.removedSensitiveParam) return;
  history.replaceState(
    null,
    '',
    `${location.pathname}${safeQuery.encoded ? `?${safeQuery.encoded}` : ''}${safeFragment.encoded ? `#${safeFragment.encoded}` : ''}`,
  );
}

export interface HostedAuthClient {
  signInWithPassword(credentials: SignInWithPasswordCredentials): ReturnType<GoTrueClient['signInWithPassword']>;
  getSession(): ReturnType<GoTrueClient['getSession']>;
  refreshSession(): ReturnType<GoTrueClient['refreshSession']>;
  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void): {
    data: { subscription: Subscription };
  };
  signOut(options?: { scope?: 'global' | 'local' | 'others' }): ReturnType<GoTrueClient['signOut']>;
}

export interface HostedAuthApi {
  signInWithPassword(credentials: SignInWithPasswordCredentials): ReturnType<GoTrueClient['signInWithPassword']>;
  getSession(): ReturnType<GoTrueClient['getSession']>;
  authenticatedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void): {
    data: { subscription: Subscription };
  };
  signOut(): ReturnType<GoTrueClient['signOut']>;
}

export type HostedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '未知认证错误';
}

function isRetryableRefreshError(error: unknown): boolean {
  return isAuthRetryableFetchError(error)
    || (
      typeof error === 'object'
      && error !== null
      && 'isAcquireTimeout' in error
      && error.isAcquireTimeout === true
    );
}

async function throwTerminalRefreshError(client: HostedAuthClient, refreshError: unknown): Promise<never> {
  let cleanupError: unknown = null;
  try {
    cleanupError = (await client.signOut({ scope: 'local' })).error;
  } catch (error) {
    cleanupError = error;
  }
  const cleanupSuffix = cleanupError ? `；本地会话清理失败：${errorMessage(cleanupError)}` : '';
  throw new HostedAuthError(
    `登录状态刷新失败，请重新登录：${errorMessage(refreshError)}${cleanupSuffix}`,
    'refresh_failed',
  );
}

function createReplayableRequests(input: RequestInfo | URL, init?: RequestInit): [Request, Request] {
  if (input instanceof Request && input.bodyUsed) {
    throw new HostedAuthError(
      '无法创建认证请求，可能是请求体已经被读取，无法安全重放。',
      'request_not_replayable',
    );
  }
  let request: Request;
  try {
    request = new Request(input, init);
  } catch (error) {
    throw new HostedAuthError(
      `无法创建认证请求，可能是请求体已经被读取：${errorMessage(error)}`,
      'request_not_replayable',
    );
  }

  try {
    return [request, request.clone()];
  } catch (error) {
    throw new HostedAuthError(
      `认证请求包含不可重放的请求体，无法在令牌刷新后安全重试：${errorMessage(error)}`,
      'request_not_replayable',
    );
  }
}

function withAccessToken(request: Request, accessToken: string): Request {
  const headers = new Headers(request.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  return new Request(request, { headers });
}

async function requireSession(client: HostedAuthClient): Promise<Session> {
  const { data, error } = await client.getSession();
  if (error) {
    throw new HostedAuthError(`无法读取登录状态：${errorMessage(error)}`, 'session_read_failed');
  }
  if (!data.session?.access_token) {
    throw new HostedAuthError('当前登录状态已失效，请重新登录。', 'session_missing');
  }
  return data.session;
}

export function createHostedAuthApi(
  client: HostedAuthClient,
  fetchImpl: HostedFetch = globalThis.fetch.bind(globalThis),
): HostedAuthApi {
  let refreshPromise: Promise<Session> | null = null;

  async function refreshSessionOnce(): Promise<Session> {
    if (!refreshPromise) {
      refreshPromise = (async () => {
        let data: Awaited<ReturnType<HostedAuthClient['refreshSession']>>['data'];
        let error: Awaited<ReturnType<HostedAuthClient['refreshSession']>>['error'];
        try {
          ({ data, error } = await client.refreshSession());
        } catch (refreshError) {
          if (isRetryableRefreshError(refreshError)) {
            throw new HostedAuthError(
              `认证服务暂时不可用，登录状态已保留，请稍后重试：${errorMessage(refreshError)}`,
              'refresh_retryable',
            );
          }
          return throwTerminalRefreshError(client, refreshError);
        }
        if (error || !data.session?.access_token) {
          if (isAuthRetryableFetchError(error)) {
            throw new HostedAuthError(
              `认证服务暂时不可用，登录状态已保留，请稍后重试：${errorMessage(error)}`,
              'refresh_retryable',
            );
          }
          return throwTerminalRefreshError(client, error);
        }
        return data.session;
      })().finally(() => {
        refreshPromise = null;
      });
    }
    return refreshPromise;
  }

  async function signOutEverywhere(): ReturnType<GoTrueClient['signOut']> {
    let remoteError: unknown = null;
    try {
      remoteError = (await client.signOut({ scope: 'global' })).error;
    } catch (error) {
      remoteError = error;
    }

    if (!remoteError) return { error: null };

    let localError: unknown = null;
    try {
      localError = (await client.signOut({ scope: 'local' })).error;
    } catch (error) {
      localError = error;
    }

    if (localError) {
      return {
        error: new AuthError(
          `服务端撤销失败，且本地登录状态清理失败：${errorMessage(remoteError)}；${errorMessage(localError)}`,
          undefined,
          'sign_out_cleanup_failed',
        ),
      };
    }

    return {
      error: new AuthError(
        `本地已退出，服务端撤销失败：${errorMessage(remoteError)}`,
        undefined,
        'remote_sign_out_failed',
      ),
    };
  }

  return Object.freeze({
    signInWithPassword: (credentials: SignInWithPasswordCredentials) => client.signInWithPassword(credentials),
    getSession: () => client.getSession(),
    onAuthStateChange: (callback: (event: AuthChangeEvent, session: Session | null) => void) => client.onAuthStateChange(callback),
    signOut: signOutEverywhere,
    async authenticatedFetch(input: RequestInfo | URL, init?: RequestInit) {
      const [initialRequest, retryRequest] = createReplayableRequests(input, init);
      const currentSession = await requireSession(client);
      const response = await fetchImpl(withAccessToken(initialRequest, currentSession.access_token));

      if (response.status !== 401) {
        return response;
      }

      const refreshedSession = await refreshSessionOnce();
      const retryResponse = await fetchImpl(withAccessToken(retryRequest, refreshedSession.access_token));
      if (retryResponse.status === 401) {
        const cleanup = await client.signOut({ scope: 'local' });
        if (cleanup.error) {
          throw new HostedAuthError(
            `请求重试后仍未通过认证，且本地会话清理失败：${errorMessage(cleanup.error)}`,
            'refresh_failed',
          );
        }
      }
      return retryResponse;
    },
  });
}

function browserAuthUrl(): string {
  return new URL('/auth/v1', window.location.origin).toString().replace(/\/$/, '');
}

declare global {
  interface Window {
    SupaOAuthHostedAuth: HostedAuthApi;
  }
}

if (typeof window !== 'undefined') {
  clearLegacyAccountAccessToken(window);
  clearLegacyAccountTokensFromUrl(window.location, window.history);
  const client = new GoTrueClient({
    url: browserAuthUrl(),
    storageKey: HOSTED_AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  });

  window.SupaOAuthHostedAuth = createHostedAuthApi(client);
}
