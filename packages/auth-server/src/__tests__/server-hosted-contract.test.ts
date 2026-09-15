import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { hostedServerContracts, AdminLoginInputSchema } from '../../../shared/src/server-hosted.js';
import { decodeSchema } from '../../../shared/src/schema.js';
import { validateServerResponse } from '../utils/server-contract.js';
import { hostedContract } from '../utils/hosted-contract.js';
import { ApiContractError } from '../utils/api-contract.js';
import { storageRoutes } from '../storage/index.js';
import { createHostedPageRoutes } from '../routes/hosted-pages.js';

function contractApp() {
  return new Elysia().onError(({ error, set }) => {
    if (!(error instanceof ApiContractError)) throw error;
    set.status = error.status;
    return { success: false, error: { code: error.code, message: error.message } };
  });
}

describe('hosted server request and protocol contracts', () => {
  test('retains hidden static and wildcard registrations without inventing OpenAPI paths', () => {
    const hosted = createHostedPageRoutes();
    const hiddenPaths = [
      '/hosted-auth.js', '/favicon.ico', '/favicon.svg', '/login.html', '/authorize.html',
      '/logout.html', '/claim.html', '/account.html', '/change-password.html',
      '/custom-ui/*', '/_app/*', '/admin/*', '/robots.txt',
    ];
    for (const path of hiddenPaths) {
      const route = hosted.routes.find((route) => route.path === path);
      if (!route) throw new Error(`Missing hosted registration: ${path}`);
      expect(route.hooks.detail).toMatchObject({ hide: true, 'x-supauth-contract': { source: expect.stringContaining('hosted:') } });
    }
    for (const path of ['/v1/storage/upload/:bucketId/*', '/v1/storage/sign-url/:bucketId/*', '/v1/storage/delete/:bucketId/*']) {
      const route = storageRoutes.routes.find((route) => route.path === path);
      if (!route) throw new Error(`Missing storage registration: ${path}`);
      expect(route.hooks.detail).toMatchObject({ hide: true });
    }
    for (const name of ['page', 'storageList'] as const) {
      const hooks = hostedContract(name);
      expect(hostedServerContracts[name].request).toBe('none');
      expect(hooks).not.toHaveProperty('query');
      expect(hooks).not.toHaveProperty('body');
    }
  });

  test('rejects non-object login bodies before running a handler', async () => {
    let calls = 0;
    const app = contractApp().post('/login', () => {
      calls++;
      return { success: true, token: 'session' };
    }, hostedContract('adminLogin'));
    for (const body of [null, [], 'token']) {
      const response = await app.handle(new Request('http://localhost/login', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }));
      expect(response.status).toBe(400);
    }
    expect(calls).toBe(0);
    expect(() => decodeSchema(AdminLoginInputSchema, { token: undefined })).toThrow();
  });

  test('validates identity and login results through the shared admin contracts', async () => {
    await expect(validateServerResponse(hostedServerContracts.adminIdentity, {
      id: 'admin', email: 'admin@example.test', name: 'Admin', roles: ['admin'], permissions: ['*'],
      authorization_source: 'admin_allowlist', avatar: null,
    })).resolves.toBeUndefined();
    await expect(validateServerResponse(hostedServerContracts.adminIdentity, { id: 'admin' }))
      .rejects.toMatchObject({ status: 502, code: 'invalid_upstream_response' });
    await expect(validateServerResponse(hostedServerContracts.adminLogin, { success: true, token: 42 }))
      .rejects.toMatchObject({ status: 502 });
  });

  test('keeps HTML, redirect, binary and JSON errors distinct', async () => {
    await expect(validateServerResponse(hostedServerContracts.page,
      new Response('<!doctype html><html><body>Login</body></html>', { headers: { 'content-type': 'text/html' } })))
      .resolves.toBeUndefined();
    await expect(validateServerResponse(hostedServerContracts.page, Response.json({ success: true })))
      .rejects.toMatchObject({ status: 502 });
    const redirect = new Response(null, { status: 307, headers: { location: '/admin/get-started' } });
    await expect(validateServerResponse(hostedServerContracts.adminRoot, redirect)).resolves.toBeUndefined();
    await expect(validateServerResponse(hostedServerContracts.adminRoot,
      new Response(null, { status: 307, headers: { location: 'https://untrusted.example.test' } })))
      .rejects.toMatchObject({ status: 502 });
    const bytes = new Uint8Array([1, 2, 3]);
    const image = new Response(bytes, { headers: { 'content-type': 'image/png' } });
    await expect(validateServerResponse(hostedServerContracts.storageBrandingRead, image)).resolves.toBeUndefined();
    expect(image.bodyUsed).toBe(false);
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(bytes);
  });

  test('storage rejects malformed expiry and raw upload headers before touching its adapter', async () => {
    const app = new Elysia().use(storageRoutes);
    const invalidExpiry = await app.handle(new Request('http://localhost/v1/storage/sign-url/avatars/user/avatar?expires=1garbage'));
    expect(invalidExpiry.status).toBe(400);
    const invalidMime = await app.handle(new Request('http://localhost/v1/storage/upload/branding/logo.png', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }));
    expect(invalidMime.status).toBe(400);
  });

  test('retired routes remain counted, hidden, and incapable of returning a fake success', async () => {
    const hooks = hostedContract('retired');
    expect(hooks.detail.hide).toBe(true);
    expect(hooks.detail['x-supauth-contract']).toMatchObject({ retired: true, source: 'hosted:retired' });
    await expect(validateServerResponse(hostedServerContracts.retired, { success: true }))
      .rejects.toMatchObject({ status: 502 });
  });
});
