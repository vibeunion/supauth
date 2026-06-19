import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';
import { loadConfig } from '../config/index.js';

describe('application secret lifecycle', () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: string }> = [];

  beforeEach(() => {
    process.env.SUPACLOUD_INTERNAL_API_URL = 'http://supacloud.internal';
    process.env.SUPACLOUD_INTERNAL_TOKEN = 'test-token';
    process.env.SUPACLOUD_PROJECT_REF = 'test-project';
    process.env.SUPACLOUD_RUNTIME_URL = 'http://runtime.internal';
    process.env.SUPACLOUD_DATABASE_URL = 'postgres://test';
    delete process.env.SUPACLOUD_API_URL;
    delete process.env.SUPACLOUD_MASTER_TOKEN;
    delete process.env.PROJECT_REF;
    delete process.env.OAUTH_RUNTIME_URL;
    delete process.env.DATABASE_URL;
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
          }],
          total: 1,
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
  });

  it('proxies secret APIs to SupaCloud OAuth client management', async () => {
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

    expect(listResponse.status).toBe(200);
    expect(createResponse.status).toBe(200);
    expect(disableResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(200);
    const normalizedCalls = calls.map((call) => [
      call.method,
      new URL(call.url).pathname.replace(/\/v1\/projects\/[^/]+/, '/v1/projects/{projectRef}'),
    ]);
    expect(normalizedCalls.filter(([, path]) => path.includes('/auth/oauth-clients/'))).toEqual([
      ['GET', '/v1/projects/{projectRef}/auth/oauth-clients/client-one/secrets'],
      ['POST', '/v1/projects/{projectRef}/auth/oauth-clients/client-one/secrets'],
      ['POST', '/v1/projects/{projectRef}/auth/oauth-clients/client-one/secrets/sec-one/disable'],
      ['DELETE', '/v1/projects/{projectRef}/auth/oauth-clients/client-one/secrets/sec-one'],
    ]);
    expect(normalizedCalls).toContainEqual(['POST', '/v1/projects/{projectRef}/webhooks/events']);
    expect(JSON.parse(calls[1].body || '{}')).toEqual({
      name: 'Rotating secret',
      expires_at: '2026-12-31T00:00:00.000Z',
    });
  });

  it('normalizes OAuth client list envelopes for the admin applications page', async () => {
    const { applicationRoutes } = await import('../routes/applications.js');
    const app = new Elysia().use(applicationRoutes);

    const response = await app.handle(new Request('http://supauth.local/v1/applications'));
    const payload = await response.json() as { items: Array<Record<string, unknown>>; total: number };

    expect(response.status).toBe(200);
    expect(payload.total).toBe(1);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({
      client_id: 'client-one',
      client_name: 'Client One',
    });
  });

  it('treats unsupported per-client secret listing as an empty tracked-secret list', async () => {
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, method: 'GET' });
      return Promise.resolve(new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404 }));
    }) as unknown as typeof fetch;

    const { applicationRoutes } = await import('../routes/applications.js');
    const app = new Elysia().use(applicationRoutes);
    const response = await app.handle(new Request('http://supauth.local/v1/applications/client-one/secrets'));
    const payload = await response.json() as { items: unknown[]; total: number };

    expect(response.status).toBe(200);
    expect(payload).toEqual({ items: [], total: 0 });
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
    const payload = await response.json() as { error: string };

    expect(response.status).toBe(501);
    expect(payload.error).toBe('not_supported');
  });
});
