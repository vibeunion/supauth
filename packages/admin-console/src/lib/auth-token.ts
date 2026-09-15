// Shared admin access-token wiring for API/Data/Auth providers.
// The token may come from the legacy ADMIN_TOKEN session flow or @svadmin/sso.

export const ADMIN_TOKEN_KEY = 'supaoauth_admin_token';

let accessTokenProvider: (() => Promise<string | null> | string | null) | null = null;

export function setAdminAccessTokenProvider(provider: (() => Promise<string | null> | string | null) | null): void {
  accessTokenProvider = provider;
}

export async function getAdminAccessToken(): Promise<string | null> {
  if (accessTokenProvider) {
    const token = await accessTokenProvider();
    if (token) return token;
  }

  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

export async function getCurrentAdminAccessToken(): Promise<string | null> {
  // 已配置的身份源为空时必须保持未登录，不能回退到旧身份凭据。
  if (accessTokenProvider) return accessTokenProvider();
  return getAdminAccessToken();
}

export function setStoredAdminToken(token: string): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
  }
}

export function clearStoredAdminToken(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
  }
}
