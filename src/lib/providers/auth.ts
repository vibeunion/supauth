// SupaOAuth AuthProvider for @svadmin/core
// Uses the SupaOAuth Management API for admin console authentication

import type { AuthProvider, Identity, AuthActionResult, CheckResult } from '@svadmin/core';

const API_BASE = import.meta.env.VITE_AUTH_SERVER_URL || '/api';
const TOKEN_KEY = 'supaoauth_admin_token';

async function request(path: string, options: RequestInit = {}): Promise<unknown> {
  const url = `${API_BASE}${path}`;
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string>),
  };
  const res = await fetch(url, { ...options, headers, credentials: 'include' });
  if (!res.ok) throw new Error(`Auth API ${res.status}`);
  return res.json();
}

export const supaoauthAuthProvider: AuthProvider = {
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
        localStorage.setItem(TOKEN_KEY, token);
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
    localStorage.removeItem(TOKEN_KEY);
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
