import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';
import type { AdminPrincipal } from '../auth/admin-permissions.js';
import { withAdminRequestContext } from '../auth/request-context.js';
import { loadConfig } from '../config/index.js';

describe('application secret lifecycle', () => {
  const originalFetch = globalThis.fetch;
  const originalBffSigningSecret = process.env.SUPAOAUTH_BFF_SIGNING_SECRET;
  const bffSigningSecret = 'test-bff-signing-secret-0123456789abcdef';
  const adminPrincipal: AdminPrincipal = {
    id: 'application-test-admin',
    email: 'application-test-admin@example.test',
    name: 'Application Test Admin',
    roles: ['admin'],
    permissions: ['*'],
    authorization_source: 'rbac_projection',
  };
  const calls: Array<{ url: string; method: string; body?: string }> = [];

  beforeEach(() => {
    process.env.SUPACLOUD_INTERNAL_API_URL = 'http://supacloud.internal';
    process.env.SUPACLOUD_INTERNAL_TOKEN = 'test-token';
    process.env.SUPACLOUD_PROJECT_REF = 'test-project';
    process.env.SUPACLOUD_RUNTIME_URL = 'http://runtime.internal';
    process.env.SUPACLOUD_DATABASE_URL = 'postgres://test';
    process.env.SUPAOAUTH_BFF_SIGNING_SECRET = bffSigningSecret;
    delete process.env.SUPACLOUD_API_URL;
    delete process.env.SUPACLOUD_MASTER_TOKEN;
    delete process.env.PROJECT_REF;
    delete process.env.OAUTH_RUNTIME_URL;
    delete process.env.DATABASE_URL;
    delete process.env.SUPAUTH_OAUTH_AUTHORIZATION_PROJECT_REF;
    loadConfig();

    calls.length = 0;
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method || 'GET';
      calls.push({
        url,
        method,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });

      if (method === 'GET' && new URL(url).pathname.endsWith('/auth/oauth-clients')) {
        return Promise.resolve(Response.json({
          oauth_clients: [{
            client_id: 'client-one',
            client_name: 'Client One',
            client_type: 'confidential',
            redirect_uris: ['https://app.example.test/callback'],
            grant_types: ['authorization_code'],
            client_secret: 'must-not-leak-from-list',
          }],
          total: 1,
        }));
      }

      if (new URL(url).pathname.endsWith('/auth/oauth-clients/client-one')) {
        return Promise.resolve(Response.json({
          client_id: 'client-one',
          client_name: 'Client One',
          client_type: 'confidential',
          redirect_uris: ['https://app.example.test/callback'],
          grant_types: ['authorization_code'],
          client_secret: 'must-not-leak-from-detail',
        }));
      }

      return Promise.resolve(Response.json({
        id: 'sec_test',
        secret_id: 'sec_test',
        name: 'Client secret',
        status: 'active',
        secret: 'secret_once',
      }));
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalBffSigningSecret === undefined) delete process.env.SUPAOAUTH_BFF_SIGNING_SECRET;
    else process.env.SUPAOAUTH_BFF_SIGNING_SECRET = originalBffSigningSecret;
  });

  it('rejects unsupported per-client secret lifecycle operations', async () => {
    const { applicationRoutes } = await import('../routes/applications.js');
    const app = new Elysia().use(applicationRoutes);

    const listResponse = await app.handle(new Request('http://supauth.local/v1/applications/client-one/secrets'));
    const createResponse = await app.handle(new Request('http://supauth.local/v1/applications/client-one/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Rotating secret', expires_at: '2026-12-31T00:00:00.000Z' }),
    }));
    const disableResponse = await app.handle(new Request('http://supauth.local/v1/applications/client-one/secrets/sec-one/disable', {
      method: 'POST',
    }));
    const deleteResponse = await app.handle(new Request('http://supauth.local/v1/applications/client-one/secrets/sec-one', {
      method: 'DELETE',
    }));

    expect([listResponse, createResponse, disableResponse, deleteResponse].map(response => response.status)).toEqual([501, 501, 501, 501]);
    expect(calls).toHaveLength(0);
  });

  it('normalizes OAuth client list envelopes for the admin applications page', async () => {
    const { applicationRoutes } = await import('../routes/applications.js');
    const app = new Elysia().use(applicationRoutes);

    const response = await withAdminRequestContext(
      { requestId: 'application-list-request', principal: adminPrincipal },
      () => app.handle(new Request('http://supauth.local/v1/applications')),
    );
    const payload = await response.json() as { items: Array<Record<string, unknown>>; total: number };

    expect(response.status).toBe(200);
    expect(payload.total).toBe(1);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({
      client_id: 'client-one',
      client_name: 'Client One',
      secret_configured: true,
    });
    expect(payload.items[0]).not.toHaveProperty('client_secret');
  });

  it('removes an unexpected secret from OAuth client detail reads', async () => {
    const { applicationRoutes } = await import('../routes/applications.js');
    const app = new Elysia().use(applicationRoutes);

    const response = await app.handle(new Request('http://supauth.local/v1/applications/client-one'));
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ client_id: 'client-one', secret_configured: true });
    expect(payload).not.toHaveProperty('client_secret');
  });

  it('removes an unexpected secret from OAuth client update responses', async () => {
    const { applicationRoutes } = await import('../routes/applications.js');
    const app = new Elysia().use(applicationRoutes);

    const response = await withAdminRequestContext(
      { requestId: 'application-update-request', principal: adminPrincipal },
      () => app.handle(new Request('http://supauth.local/v1/applications/client-one', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_name: 'Updated Client' }),
      })),
    );
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ client_id: 'client-one', secret_configured: true });
    expect(payload).not.toHaveProperty('client_secret');
  });

  it('uses oauthAuthorizationProjectRef for OAuth client management when configured', async () => {
    process.env.SUPAUTH_OAUTH_AUTHORIZATION_PROJECT_REF = 'central-auth-project';
    loadConfig();

    const { applicationRoutes } = await import('../routes/applications.js');
    const app = new Elysia().use(applicationRoutes);

    const listResponse = await withAdminRequestContext(
      { requestId: 'central-application-list-request', principal: adminPrincipal },
      () => app.handle(new Request('http://supauth.local/v1/applications')),
    );
    const secretsResponse = await app.handle(new Request('http://supauth.local/v1/applications/client-one/secrets'));

    expect(listResponse.status).toBe(200);
    expect(secretsResponse.status).toBe(501);

    const normalizedCalls = calls.map((call) => [
      call.method,
      new URL(call.url).pathname,
    ]);
    expect(normalizedCalls).toContainEqual(['GET', '/v1/projects/central-auth-project/auth/oauth-clients']);
    expect(normalizedCalls).not.toContainEqual(['GET', '/v1/projects/central-auth-project/auth/oauth-clients/client-one/secrets']);
  });

  it('does not convert unsupported per-client secret listing to an empty list', async () => {
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, method: 'GET' });
      return Promise.resolve(new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404 }));
    }) as unknown as typeof fetch;

    const { applicationRoutes } = await import('../routes/applications.js');
    const app = new Elysia().use(applicationRoutes);
    const response = await app.handle(new Request('http://supauth.local/v1/applications/client-one/secrets'));
    expect(response.status).toBe(501);
  });

  it('returns a clear not-supported response for unsupported per-client secret writes', async () => {
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({
        url,
        method: init?.method || 'GET',
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      return Promise.resolve(new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404 }));
    }) as unknown as typeof fetch;

    const { applicationRoutes } = await import('../routes/applications.js');
    const app = new Elysia().use(applicationRoutes);
    const response = await app.handle(new Request('http://supauth.local/v1/applications/client-one/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Extra secret' }),
    }));
    expect(response.status).toBe(501);
  });
});
