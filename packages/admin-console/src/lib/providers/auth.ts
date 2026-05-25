// SupaOAuth AuthProvider for @svadmin/core.
// Production uses @svadmin/sso OIDC PKCE; development can keep ADMIN_TOKEN login.

import type { AuthProvider, Identity, AuthActionResult, CheckResult } from '@svadmin/core';
import { createSSOAuthProvider, type SSOAuthProvider } from '@svadmin/sso';
import {
  clearStoredAdminToken,
  getAdminAccessToken,
  setAdminAccessTokenProvider,
  setStoredAdminToken,
} from '../auth-token';

const API_BASE = import.meta.env.VITE_AUTH_SERVER_URL || '/api';
const SSO_ISSUER = import.meta.env.VITE_ADMIN_SSO_ISSUER || import.meta.env.VITE_SSO_ISSUER || '';
const SSO_CLIENT_ID = import.meta.env.VITE_ADMIN_SSO_CLIENT_ID || import.meta.env.VITE_SSO_CLIENT_ID || '';
const SSO_REDIRECT_URI = import.meta.env.VITE_ADMIN_SSO_REDIRECT_URI || defaultRedirectUri();
const SSO_LOGOUT_REDIRECT_URI = import.meta.env.VITE_ADMIN_SSO_POST_LOGOUT_REDIRECT_URI || defaultLoginUri();
const USE_SSO = Boolean(SSO_ISSUER && SSO_CLIENT_ID);

async function request(path: string, options: RequestInit = {}): Promise<unknown> {
  const url = `${API_BASE}${path}`;
  const token = await getAdminAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string>),
  };
  const res = await fetch(url, { ...options, headers, credentials: 'include' });
  if (!res.ok) throw new Error(`Auth API ${res.status}`);
  return res.json();
}

function defaultRedirectUri(): string {
  if (typeof window === 'undefined') return '/admin';
  return `${window.location.origin}/admin`;
}

function defaultLoginUri(): string {
  if (typeof window === 'undefined') return '/admin/login';
  return `${window.location.origin}/admin/login`;
}

const tokenAuthProvider: AuthProvider = {
  login: async (params: Record<string, unknown>): Promise<AuthActionResult> => {
    try {
      const result = await request('/v1/auth/login', {
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
      await request('/v1/auth/logout', { method: 'POST' });
    } catch {
      // Ignore logout API errors
    }
    clearStoredAdminToken();
    return { success: true, redirectTo: '/admin/login' };
  },

  check: async (): Promise<CheckResult> => {
    try {
      await request('/v1/auth/identity');
      return { authenticated: true };
    } catch {
      return { authenticated: false, redirectTo: '/admin/login' };
    }
  },

  getIdentity: async (): Promise<Identity | null> => {
    try {
      const identity = await request('/v1/auth/identity');
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
    if (status === 401 || status === 403) {
      return { redirectTo: '/admin/login', logout: true };
    }
    return {};
  },
};

function createSupaOAuthSSOProvider(): AuthProvider {
  const ssoProvider: SSOAuthProvider = createSSOAuthProvider({
    issuer: SSO_ISSUER,
    clientId: SSO_CLIENT_ID,
    redirectUri: SSO_REDIRECT_URI,
    postLogoutRedirectUri: SSO_LOGOUT_REDIRECT_URI,
    scopes: ['openid', 'profile', 'email'],
  });

  setAdminAccessTokenProvider(() => ssoProvider.getAccessToken());

  return {
    login: () => ssoProvider.login({}),

    logout: async (): Promise<AuthActionResult> => {
      try {
        await request('/v1/auth/logout', { method: 'POST' });
      } catch {
        // Browser-side SSO logout still clears tokens even if the BFF is unreachable.
      }
      return ssoProvider.logout({});
    },

    check: async (): Promise<CheckResult> => {
      const ssoCheck = await ssoProvider.check();
      if (!ssoCheck.authenticated) {
        return { ...ssoCheck, redirectTo: ssoCheck.redirectTo || '/admin/login' };
      }

      try {
        await request('/v1/auth/identity');
        return { authenticated: true };
      } catch {
        return { authenticated: false, redirectTo: '/admin/login', logout: true };
      }
    },

    getIdentity: async (): Promise<Identity | null> => {
      try {
        const identity = await request('/v1/auth/identity');
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
      if (status === 401 || status === 403) {
        return { redirectTo: '/admin/login', logout: true };
      }
      return ssoProvider.onError?.(error) ?? {};
    },
  };
}

export const supaoauthAuthProvider: AuthProvider = USE_SSO
  ? createSupaOAuthSSOProvider()
  : tokenAuthProvider;
