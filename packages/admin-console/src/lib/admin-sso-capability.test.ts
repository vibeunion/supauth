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
});
