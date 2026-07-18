// SupaOAuth AuthProvider for @svadmin/core.
// Production uses @svadmin/sso OIDC PKCE; development can keep ADMIN_TOKEN login.

import type { AuthProvider, Identity, AuthActionResult, CheckResult } from '@svadmin/core';
import { createSSOAuthProvider, type SSOAuthProvider } from '@svadmin/sso';
import { adminApiRequest, setAdminAuthenticatedFetch } from '../admin-api';
import { adminCheckFailure } from '../admin-auth-result';
import { requireAdminAuthenticatedFetch } from '../admin-sso-capability';
import {
  clearStoredAdminToken,
  setAdminAccessTokenProvider,
  setStoredAdminToken,
} from '../auth-token';

const API_BASE = import.meta.env.VITE_AUTH_SERVER_URL || '/api';
interface AdminSsoConfig {
  issuer: string;
  clientId: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  gotrueLogoutUrl: string;
}

interface RuntimeAdminSsoConfigResponse {
  enabled?: boolean;
  issuer?: string;
  client_id?: string;
  redirect_uri?: string;
  post_logout_redirect_uri?: string;
  gotrue_logout_url?: string;
}

const COMPILED_SSO_CONFIG = normalizeAdminSsoConfig({
  issuer: import.meta.env.VITE_ADMIN_SSO_ISSUER || import.meta.env.VITE_SSO_ISSUER || '',
  client_id: import.meta.env.VITE_ADMIN_SSO_CLIENT_ID || import.meta.env.VITE_SSO_CLIENT_ID || '',
  redirect_uri: import.meta.env.VITE_ADMIN_SSO_REDIRECT_URI || defaultRedirectUri(),
  post_logout_redirect_uri: import.meta.env.VITE_ADMIN_SSO_POST_LOGOUT_REDIRECT_URI || defaultLoginUri(),
  gotrue_logout_url: import.meta.env.VITE_GOTRUE_LOGOUT_URL || '',
});
let runtimeSsoConfigPromise: Promise<AdminSsoConfig | null> | null = null;
let currentSsoProvider: SSOAuthProvider | null = null;
export let adminSsoEnabled = Boolean(COMPILED_SSO_CONFIG);

function defaultRedirectUri(): string {
  if (typeof window === 'undefined') return '/admin';
  return `${window.location.origin}/admin`;
}

function defaultLoginUri(): string {
  if (typeof window === 'undefined') return '/admin/login';
  return `${window.location.origin}/admin/login`;
}

function normalizeAdminSsoConfig(config: RuntimeAdminSsoConfigResponse): AdminSsoConfig | null {
  if (!config.enabled && !(config.issuer && config.client_id)) return null;
  const issuer = (config.issuer || '').replace(/\/+$/, '');
  const clientId = config.client_id || '';
  if (!issuer || !clientId) return null;

  return {
    issuer,
    clientId,
    redirectUri: config.redirect_uri || defaultRedirectUri(),
    postLogoutRedirectUri: config.post_logout_redirect_uri || defaultLoginUri(),
    gotrueLogoutUrl: config.gotrue_logout_url || '',
  };
}

async function loadRuntimeAdminSsoConfig(): Promise<AdminSsoConfig | null> {
  if (COMPILED_SSO_CONFIG) return COMPILED_SSO_CONFIG;
  if (!runtimeSsoConfigPromise) {
    runtimeSsoConfigPromise = fetch(`${API_BASE}/v1/public/admin-sso-config`, {
      headers: { Accept: 'application/json' },
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const config = await res.json() as RuntimeAdminSsoConfigResponse;
        return normalizeAdminSsoConfig(config);
      })
      .catch(() => null);
  }
  return runtimeSsoConfigPromise;
}

const tokenAuthProvider: AuthProvider = {
  login: async (params: Record<string, unknown>): Promise<AuthActionResult> => {
    try {
      const result = await adminApiRequest('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          token: params.token || params.password,
          email: params.email,
          password: params.password,
        }),
      });
      const token = (result as { token?: string })?.token;
      if (token) {
        setStoredAdminToken(token);
        return { success: true, redirectTo: '/admin/dashboard' };
      }
      return { success: false, error: { message: 'Login failed' } };
    } catch (e) {
      return { success: false, error: { message: (e as Error).message } };
    }
  },

  logout: async (): Promise<AuthActionResult> => {
    try {
      await adminApiRequest('/v1/auth/logout', { method: 'POST' });
    } catch {
      // Ignore logout API errors
    }
    clearStoredAdminToken();
    return { success: true, redirectTo: '/admin/login' };
  },

  check: async (): Promise<CheckResult> => {
    try {
      await adminApiRequest('/v1/auth/identity');
      return { authenticated: true };
    } catch (error) {
      return adminCheckFailure(error);
    }
  },

  getIdentity: async (): Promise<Identity | null> => {
    try {
      const identity = await adminApiRequest('/v1/auth/identity');
      return identity as Identity;
    } catch {
      return null;
    }
  },

  getPermissions: async (): Promise<unknown> => {
    // Admin console has full permissions for now; RBAC can be added later
    return { role: 'admin' };
  },

  onError: async (error: unknown): Promise<{ redirectTo?: string; logout?: boolean }> => {
    const status = (error as { statusCode?: number })?.statusCode;
    if (status === 401) {
      return { redirectTo: '/admin/login', logout: true };
    }
    return {};
  },
};

export let supaoauthAuthProvider: AuthProvider = tokenAuthProvider;

function createSupaOAuthSSOProvider(config: AdminSsoConfig): AuthProvider {
  const ssoProvider: SSOAuthProvider = createSSOAuthProvider({
    issuer: config.issuer,
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    postLogoutRedirectUri: config.postLogoutRedirectUri,
    scopes: ['openid', 'profile', 'email'],
  });
  const authenticatedFetch = requireAdminAuthenticatedFetch(ssoProvider);

  currentSsoProvider = ssoProvider;
  setAdminAccessTokenProvider(() => ssoProvider.getAccessToken());
  setAdminAuthenticatedFetch(authenticatedFetch);

  return {
    login: () => ssoProvider.login({}),

    logout: async (): Promise<AuthActionResult> => {
      // GoTrue 不在 OIDC discovery 暴露 end_session_endpoint；显式调用 logout
      // 才能清除 httpOnly cookie，避免下次 authorize 直接签发 code。
      if (config.gotrueLogoutUrl) {
        try {
          await fetch(config.gotrueLogoutUrl, { method: 'POST', credentials: 'include' });
        } catch {
          // GoTrue 不可达时仍继续清本地 token
        }
      }

      // BFF 与 GoTrue 会话独立，退出时需要分别吊销。
      try {
        await adminApiRequest('/v1/auth/logout', { method: 'POST' });
      } catch {
        // BFF 不可达时仍继续清本地 token
      }

      clearStoredAdminToken();

      // Provider 始终清理本地 SSO token；支持时再执行 RP-initiated logout。
      return ssoProvider.logout({});
    },

    check: async (): Promise<CheckResult> => {
      const ssoCheck = await ssoProvider.check();
      if (!ssoCheck.authenticated) {
        return { ...ssoCheck, redirectTo: ssoCheck.redirectTo || '/admin/login' };
      }

      try {
        await adminApiRequest('/v1/auth/identity');
        return { authenticated: true };
      } catch (error) {
        return adminCheckFailure(error);
      }
    },

    getIdentity: async (): Promise<Identity | null> => {
      try {
        const identity = await adminApiRequest('/v1/auth/identity');
        return identity as Identity;
      } catch {
        return ssoProvider.getIdentity();
      }
    },

    getPermissions: async (): Promise<unknown> => {
      const permissions = await ssoProvider.getPermissions?.();
      return permissions ?? { role: 'admin' };
    },

    onError: async (error: unknown): Promise<{ redirectTo?: string; logout?: boolean }> => {
      const status = (error as { statusCode?: number; status?: number })?.statusCode
        ?? (error as { status?: number })?.status;
      if (status === 403) return {};
      return ssoProvider.onError?.(error) ?? {};
    },
  };
}

export async function initializeAdminAuthProvider(): Promise<AuthProvider> {
  if (currentSsoProvider) return supaoauthAuthProvider;

  const ssoConfig = await loadRuntimeAdminSsoConfig();
  if (!ssoConfig) {
    adminSsoEnabled = false;
    setAdminAuthenticatedFetch(null);
    supaoauthAuthProvider = tokenAuthProvider;
    return supaoauthAuthProvider;
  }

  adminSsoEnabled = true;
  supaoauthAuthProvider = createSupaOAuthSSOProvider(ssoConfig);
  return supaoauthAuthProvider;
}
