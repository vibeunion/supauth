// Bun runs this module directly; the Svelte check does not include Bun's test globals.
// @ts-nocheck
import { describe, expect, test } from 'bun:test';
import { createSSOAuthProvider } from '@svadmin/sso';
import { requireAdminAuthenticatedFetch } from './admin-sso-capability.js';

describe('admin SSO refresh capability', () => {
  test('fails explicitly when the provider cannot refresh and replay requests', () => {
    expect(() => requireAdminAuthenticatedFetch({})).toThrow('createAuthenticatedFetch');
  });

  test('preserves the provider receiver when creating authenticated fetch', () => {
    const provider = {
      marker: 'bound',
      createAuthenticatedFetch(this: { marker: string }) {
        expect(this.marker).toBe('bound');
        return fetch;
      },
    };

    expect(requireAdminAuthenticatedFetch(provider)).toBe(fetch);
  });

  test('uses the installed provider capability and migrates its legacy session key', async () => {
    const sessionStorage = new Map<string, string>();
    sessionStorage.set('svadmin_sso_tokens', JSON.stringify({
      access_token: 'legacy-access',
      refresh_token: 'legacy-refresh',
      token_type: 'Bearer',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    }));
    const provider = createSSOAuthProvider({
      issuer: 'https://idp.example.test',
      clientId: 'admin-console',
      redirectUri: 'https://admin.example.test/callback',
      storage: {
        getItem: (key) => sessionStorage.get(key) ?? null,
        setItem: (key, value) => sessionStorage.set(key, value),
        removeItem: (key) => sessionStorage.delete(key),
      },
      legacyStorageKey: 'svadmin_sso',
      autoRefresh: false,
      manualEndpoints: {
        authorization_endpoint: 'https://idp.example.test/authorize',
        token_endpoint: 'https://idp.example.test/token',
        userinfo_endpoint: 'https://idp.example.test/userinfo',
      },
    });

    expect(requireAdminAuthenticatedFetch(provider)).toBeInstanceOf(Function);
    expect((await provider.getSession())?.access_token).toBe('legacy-access');
    expect(sessionStorage.has('svadmin_sso_tokens')).toBe(false);
    provider.destroy();
  });

  test('uses S256 and omits client secrets in browser authorization and token exchange', async () => {
    const originalWindow = globalThis.window;
    const storageValues = new Map<string, string>();
    const tokenBodies: URLSearchParams[] = [];
    const browserWindow = {
      document: {},
      navigator: {
        locks: { request: async (_name, operation) => operation() },
      },
      location: { href: 'https://admin.example.test/admin' },
      history: { replaceState: () => undefined },
      sessionStorage: {
        getItem: (key) => storageValues.get(key) ?? null,
        setItem: (key, value) => storageValues.set(key, value),
        removeItem: (key) => storageValues.delete(key),
      },
    };
    globalThis.window = browserWindow;
    const provider = createSSOAuthProvider({
      issuer: 'https://idp.example.test',
      clientId: 'admin-console',
      redirectUri: 'https://admin.example.test/admin',
      storage: 'session',
      autoRefresh: false,
      manualEndpoints: {
        authorization_endpoint: 'https://idp.example.test/authorize',
        token_endpoint: 'https://idp.example.test/token',
        userinfo_endpoint: 'https://idp.example.test/userinfo',
      },
      fetcher: async (_input, init) => {
        tokenBodies.push(new URLSearchParams(String(init?.body)));
        return Response.json({ access_token: 'access-token', token_type: 'Bearer' });
      },
    });

    try {
      expect(await provider.login({})).toEqual({ success: true });
      const authorizeUrl = new URL(browserWindow.location.href);
      expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');
      expect(authorizeUrl.searchParams.get('code_challenge')).not.toBeNull();
      expect(authorizeUrl.searchParams.has('client_secret')).toBe(false);

      browserWindow.location.href = `https://admin.example.test/admin?code=issued-code&state=${authorizeUrl.searchParams.get('state')}`;
      expect(await provider.check()).toEqual({ authenticated: true });
      expect(tokenBodies).toHaveLength(1);
      expect(tokenBodies[0].get('grant_type')).toBe('authorization_code');
      expect(tokenBodies[0].has('code_verifier')).toBe(true);
      expect(tokenBodies[0].has('client_secret')).toBe(false);
    } finally {
      provider.destroy();
      globalThis.window = originalWindow;
    }
  });
});
