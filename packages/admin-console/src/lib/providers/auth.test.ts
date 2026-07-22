// Bun runs this module directly; the Svelte check does not include Bun's test globals.
// @ts-nocheck
import { afterEach, describe, expect, mock, test } from 'bun:test';
import { buildAdminEndSessionUrl, initializeAdminAuthProvider } from './auth';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('admin SSO runtime config', () => {
  test('builds the hosted end-session navigation with the current ID token', () => {
    expect(buildAdminEndSessionUrl({
      endpoint: 'https://auth.example.test/logout',
      clientId: 'admin-client',
      idToken: 'header.payload.signature',
      postLogoutRedirectUri: 'https://auth.example.test/admin/login',
    })).toBe(
      'https://auth.example.test/logout?client_id=admin-client&id_token_hint=header.payload.signature&post_logout_redirect_uri=https%3A%2F%2Fauth.example.test%2Fadmin%2Flogin',
    );
  });

  test('preserves an unavailable config endpoint as a structured initialization failure', async () => {
    const fetcher = mock(async () => Response.json({
      code: 'upstream_unavailable',
      message: 'SupaCloud unavailable',
    }, { status: 503 }));
    globalThis.fetch = fetcher;

    await expect(initializeAdminAuthProvider()).rejects.toMatchObject({
      statusCode: 503,
      code: 'upstream_unavailable',
    });
    const requestUrl = new URL(String(fetcher.mock.calls[0][0]), 'http://localhost');
    expect(requestUrl.pathname).toBe('/api/v1/public/admin-sso-config');
  });

  test('uses the BFF principal as the authorization source', async () => {
    const fetcher = mock(async (request: RequestInfo | URL) => {
      const requestUrl = new URL(String(request), 'http://localhost');
      if (requestUrl.pathname === '/api/v1/public/admin-sso-config') {
        return Response.json({ enabled: false });
      }
      if (requestUrl.pathname === '/api/v1/auth/identity') {
        return Response.json({
          id: 'admin-1',
          roles: ['auditor'],
          permissions: ['audit.read', 'audit.export'],
          authorization_source: 'rbac_projection',
        });
      }
      return Response.json({ code: 'not_found', message: 'Not found' }, { status: 404 });
    });
    globalThis.fetch = fetcher;

    const provider = await initializeAdminAuthProvider();
    await expect(provider.getPermissions?.()).resolves.toEqual({
      roles: ['auditor'],
      permissions: ['audit.read', 'audit.export'],
      authorization_source: 'rbac_projection',
    });
  });
});
