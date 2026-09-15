import { afterEach, describe, expect, mock, test } from 'bun:test';
import { initializeAdminAuthProvider, resetAdminAuthRuntimeForTests } from './auth';
import { adminIdentityFixture, disabledSsoConfig } from './auth-fixtures';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  resetAdminAuthRuntimeForTests();
});

function serveIdentity(identity: unknown) {
  globalThis.fetch = (mock(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost');
    return Response.json(url.pathname.endsWith('/admin-sso-config') ? disabledSsoConfig : identity);
  }));
}

describe('admin identity contract', () => {
  test('maps the nullable wire avatar to an omitted optional UI field', async () => {
    serveIdentity(adminIdentityFixture);
    const provider = await initializeAdminAuthProvider();
    const identity = await provider.getIdentity();
    expect(identity?.id).toBe('admin-1');
    expect(identity).not.toHaveProperty('avatar');
    await expect(provider.check()).resolves.toEqual({ authenticated: true });
  });

  test.each([
    { ...adminIdentityFixture, roles: [1] },
    { ...adminIdentityFixture, permissions: 'admin' },
    { ...adminIdentityFixture, authorization_source: 'untrusted' },
    { id: 'admin-1' },
  ])('does not authenticate a malformed identity response', async identity => {
    serveIdentity(identity);
    const provider = await initializeAdminAuthProvider();
    expect((await provider.check()).authenticated).toBe(false);
    await expect(provider.getIdentity()).resolves.toBeNull();
    await expect(provider.getPermissions?.()).rejects.toMatchObject({
      statusCode: 502, code: 'invalid_upstream_response',
    });
  });

  test('rejects malformed SSO configuration without retaining its payload', async () => {
    const secret = 'fixture-private-metadata';
    globalThis.fetch = (mock(async () => Response.json({
      ...disabledSsoConfig, issuer: { secret },
    })));
    await expect(initializeAdminAuthProvider()).rejects.toMatchObject({
      code: 'invalid_upstream_response', body: undefined,
    });
  });
});
