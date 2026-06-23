import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';
import { loadConfig } from '../config/index.js';

describe('SupaCloud Management API facade routes', () => {
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
      calls.push({
        url,
        method: init?.method || 'GET',
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      return Promise.resolve(Response.json({ items: [{ id: 'one' }], total: 1, id: 'one' }));
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('proxies organization, RBAC, audit, webhook, and user management reads to SupaCloud', async () => {
    const [
      { organizationRoutes },
      { roleRoutes },
      { auditRoutes },
      { webhookRoutes },
      { userRoutes },
      { passkeyRoutes },
    ] = await Promise.all([
      import('../routes/organizations.js'),
      import('../routes/roles.js'),
      import('../routes/audit.js'),
      import('../routes/webhooks.js'),
      import('../routes/users.js'),
      import('../routes/passkeys.js'),
    ]);
    const app = new Elysia()
      .use(organizationRoutes)
      .use(roleRoutes)
      .use(auditRoutes)
      .use(webhookRoutes)
      .use(userRoutes)
      .use(passkeyRoutes);

    const requests = [
      'http://supauth.local/v1/organizations',
      'http://supauth.local/v1/roles',
      'http://supauth.local/v1/roles/role-one/assign',
      'http://supauth.local/v1/audit?resource_type=user&limit=5',
      'http://supauth.local/v1/webhooks',
      'http://supauth.local/v1/users/user-one/roles',
      'http://supauth.local/v1/users/user-one/permissions?org_id=org-one',
      'http://supauth.local/v1/passkeys/user-one',
    ];
    const responses = [];
    for (const request of requests) {
      responses.push(await app.handle(new Request(request)));
    }

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200, 200, 200, 200]);
    expect(calls.map((call) => {
      const url = new URL(call.url);
      return [call.method, `${url.pathname.replace(/\/v1\/projects\/[^/]+/, '/v1/projects/{projectRef}')}${url.search}`];
    })).toEqual([
      ['GET', '/v1/projects/{projectRef}/organizations'],
      ['GET', '/v1/projects/{projectRef}/rbac/roles'],
      ['GET', '/v1/projects/{projectRef}/rbac/roles/role-one/assign'],
      ['GET', '/v1/projects/{projectRef}/audit?resource_type=user&limit=5'],
      ['GET', '/v1/projects/{projectRef}/webhooks'],
      ['GET', '/v1/projects/{projectRef}/auth/users/user-one/roles'],
      ['GET', '/v1/projects/{projectRef}/auth/users/user-one/permissions?org_id=org-one'],
      ['GET', '/v1/projects/{projectRef}/auth/users/user-one/passkeys'],
    ]);
  });

  it('falls back to the current SupaCloud global organizations API when project-scoped organizations are absent', async () => {
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({
        url,
        method: init?.method || 'GET',
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      const pathname = new URL(url).pathname;
      if (/^\/v1\/projects\/[^/]+\/organizations$/.test(pathname)) {
        return Promise.resolve(new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404 }));
      }
      if (pathname === '/v1/organizations') {
        return Promise.resolve(Response.json([{ id: 'global-one', name: 'Global One', slug: 'global-one' }]));
      }
      return Promise.resolve(Response.json({ items: [], total: 0 }));
    }) as unknown as typeof fetch;

    const { organizationRoutes } = await import('../routes/organizations.js');
    const app = new Elysia().use(organizationRoutes);
    const response = await app.handle(new Request('http://supauth.local/v1/organizations'));
    const payload = await response.json() as { items: Array<Record<string, unknown>>; total: number };

    expect(response.status).toBe(200);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]?.id).toBe('global-one');
    expect(calls.map((call) => new URL(call.url).pathname.replace(/\/v1\/projects\/[^/]+/, '/v1/projects/{projectRef}'))).toEqual([
      '/v1/projects/{projectRef}/organizations',
      '/v1/organizations',
    ]);
  });

  it('returns empty audit, webhook, and webhook log lists when the SupaCloud facade routes are not implemented yet', async () => {
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({
        url,
        method: init?.method || 'GET',
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      return Promise.resolve(new Response(JSON.stringify({ message: 'Route not found', code: '404' }), { status: 404 }));
    }) as unknown as typeof fetch;

    const [{ auditRoutes }, { webhookRoutes }] = await Promise.all([
      import('../routes/audit.js'),
      import('../routes/webhooks.js'),
    ]);
    const app = new Elysia().use(auditRoutes).use(webhookRoutes);

    const auditResponse = await app.handle(new Request('http://supauth.local/v1/audit?limit=5'));
    const webhookResponse = await app.handle(new Request('http://supauth.local/v1/webhooks'));
    const webhookLogsResponse = await app.handle(new Request('http://supauth.local/v1/webhooks/hook-one/logs?limit=5'));
    const auditPayload = await auditResponse.json() as { items: unknown[]; total: number };
    const webhookPayload = await webhookResponse.json() as { items: unknown[]; total: number };
    const webhookLogsPayload = await webhookLogsResponse.json() as { items: unknown[]; total: number };

    expect(auditResponse.status).toBe(200);
    expect(webhookResponse.status).toBe(200);
    expect(webhookLogsResponse.status).toBe(200);
    expect(auditPayload).toEqual({ items: [], total: 0 });
    expect(webhookPayload).toEqual({ items: [], total: 0 });
    expect(webhookLogsPayload).toEqual({ items: [], total: 0 });
    expect(calls.map((call) => new URL(call.url).pathname.replace(/\/v1\/projects\/[^/]+/, '/v1/projects/{projectRef}'))).toEqual([
      '/v1/projects/{projectRef}/audit',
      '/v1/projects/{projectRef}/webhooks',
      '/v1/projects/{projectRef}/webhooks/hook-one/logs',
    ]);
  });
});
