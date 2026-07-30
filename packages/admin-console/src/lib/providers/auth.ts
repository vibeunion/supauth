// SupaOAuth AuthProvider for @svadmin/core.
// Production uses @svadmin/sso OIDC PKCE; development can keep ADMIN_TOKEN login.

import type { AuthProvider, Identity, AuthActionResult, CheckResult } from '@svadmin/core';
import { createSSOAuthProvider, type SSOAuthProvider } from '@svadmin/sso';
import { AdminApiError, adminApiRequest, setAdminAuthenticatedFetch } from '../admin-api';
import { adminCheckFailure } from '../admin-auth-result';
import { requireAdminAuthenticatedFetch } from '../admin-sso-capability';
import {
  clearStoredAdminToken,
  setAdminAccessTokenProvider,
  setStoredAdminToken,
} from '../auth-token';

interface AdminSsoConfig {
  issuer: string;
  clientId: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  endSessionEndpoint: string;
}

interface RuntimeAdminSsoConfigResponse {
  enabled?: boolean;
  issuer?: string;
  client_id?: string;
  redirect_uri?: string;
  post_logout_redirect_uri?: string;
  end_session_endpoint?: string;
}

interface AdminEndSessionInput {
  endpoint: string;
  clientId: string;
  idToken: string;
  postLogoutRedirectUri: string;
}

interface AdminPrincipalPermissions {
  roles: string[];
  permissions: string[];
  authorization_source: string;
}

const COMPILED_SSO_CONFIG = normalizeAdminSsoConfig({
  issuer: import.meta.env.VITE_ADMIN_SSO_ISSUER || import.meta.env.VITE_SSO_ISSUER || '',
  client_id: import.meta.env.VITE_ADMIN_SSO_CLIENT_ID || import.meta.env.VITE_SSO_CLIENT_ID || '',
  redirect_uri: import.meta.env.VITE_ADMIN_SSO_REDIRECT_URI || defaultRedirectUri(),
  post_logout_redirect_uri: import.meta.env.VITE_ADMIN_SSO_POST_LOGOUT_REDIRECT_URI || defaultLoginUri(),
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

function defaultLogoutUri(): string {
  if (typeof window === 'undefined') return '/logout';
  return `${window.location.origin}/logout`;
}

export function buildAdminEndSessionUrl(input: AdminEndSessionInput): string {
  const browserOrigin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  const logoutUrl = new URL(input.endpoint, browserOrigin);
  if (!['http:', 'https:'].includes(logoutUrl.protocol) || logoutUrl.username || logoutUrl.password) {
    throw new TypeError('Admin end-session endpoint must be an http(s) URL without credentials');
  }
  logoutUrl.searchParams.set('client_id', input.clientId);
  logoutUrl.searchParams.set('id_token_hint', input.idToken);
  logoutUrl.searchParams.set('post_logout_redirect_uri', input.postLogoutRedirectUri);
  return logoutUrl.toString();
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
    endSessionEndpoint: config.end_session_endpoint || defaultLogoutUri(),
  };
}

async function loadRuntimeAdminSsoConfig(): Promise<AdminSsoConfig | null> {
  if (COMPILED_SSO_CONFIG) return COMPILED_SSO_CONFIG;
  if (runtimeSsoConfigPromise) return runtimeSsoConfigPromise;

  const pendingConfig = requestRuntimeAdminSsoConfig();
  runtimeSsoConfigPromise = pendingConfig;
  try {
    return await pendingConfig;
  } catch (error) {
    if (runtimeSsoConfigPromise === pendingConfig) runtimeSsoConfigPromise = null;
    throw error;
  }
}

async function requestRuntimeAdminSsoConfig(): Promise<AdminSsoConfig | null> {
  const response = await adminApiRequest('/v1/public/admin-sso-config');
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new AdminApiError(
      'Admin SSO config returned an invalid response',
      502,
      'invalid_upstream_response',
      response,
    );
  }
  return normalizeAdminSsoConfig(response as RuntimeAdminSsoConfigResponse);
}

function isStringArray(candidate: unknown): candidate is string[] {
  return Array.isArray(candidate) && candidate.every((entry) => typeof entry === 'string');
}

function adminPrincipalPermissions(identity: unknown): AdminPrincipalPermissions {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw new AdminApiError('Admin identity returned an invalid response', 502, 'invalid_upstream_response', identity);
  }
  const principal = identity as Record<string, unknown>;
  const roles = principal.roles;
  const permissions = principal.permissions;
  const authorizationSource = principal.authorization_source;
  if (
    !isStringArray(roles)
    || !isStringArray(permissions)
    || typeof authorizationSource !== 'string'
  ) {
    throw new AdminApiError('Admin identity is missing authorization data', 502, 'invalid_upstream_response', identity);
  }
  return { roles, permissions, authorization_source: authorizationSource };
}

async function getAdminPrincipalPermissions(): Promise<AdminPrincipalPermissions> {
  return adminPrincipalPermissions(await adminApiRequest('/v1/auth/identity'));
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
    let revokeError: unknown = null;
    try {
      await adminApiRequest('/v1/auth/logout', { method: 'POST' });
    } catch (error) {
      revokeError = error;
    }
    clearStoredAdminToken();
    if (revokeError) {
      return { success: false, error: { message: (revokeError as Error).message } };
    }
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
    return getAdminPrincipalPermissions();
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
    legacyStorageKey: 'svadmin_sso',
  });
  const authenticatedFetch = requireAdminAuthenticatedFetch(ssoProvider);

  currentSsoProvider = ssoProvider;
  setAdminAccessTokenProvider(() => ssoProvider.getAccessToken());
  setAdminAuthenticatedFetch(authenticatedFetch);

  return {
    login: () => ssoProvider.login({}),

    logout: async (): Promise<AuthActionResult> => {
      let revokeError: unknown = null;
      try {
        await adminApiRequest('/v1/auth/logout', { method: 'POST' });
      } catch (error) {
        revokeError = error;
      }
      let currentSession: Awaited<ReturnType<SSOAuthProvider['getSession']>> = null;
      try {
        currentSession = await ssoProvider.getSession();
      } catch {
        currentSession = null;
      }
      clearStoredAdminToken();
      const providerLogout = await ssoProvider.logout({});
      if (currentSession?.id_token && typeof window !== 'undefined') {
        window.location.assign(buildAdminEndSessionUrl({
          endpoint: config.endSessionEndpoint,
          clientId: config.clientId,
          idToken: currentSession.id_token,
          postLogoutRedirectUri: config.postLogoutRedirectUri,
        }));
        return { success: true };
      }
      if (revokeError) {
        return {
          success: false,
          error: { message: (revokeError as Error).message },
          redirectTo: providerLogout.redirectTo,
        };
      }
      return providerLogout;
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
      return getAdminPrincipalPermissions();
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
