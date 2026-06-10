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

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200, 200, 200]);
    expect(calls.map((call) => {
      const url = new URL(call.url);
      return [call.method, `${url.pathname.replace(/\/v1\/projects\/[^/]+/, '/v1/projects/{projectRef}')}${url.search}`];
    })).toEqual([
      ['GET', '/v1/projects/{projectRef}/organizations'],
      ['GET', '/v1/projects/{projectRef}/rbac/roles'],
      ['GET', '/v1/projects/{projectRef}/audit?resource_type=user&limit=5'],
      ['GET', '/v1/projects/{projectRef}/webhooks'],
      ['GET', '/v1/projects/{projectRef}/auth/users/user-one/roles'],
      ['GET', '/v1/projects/{projectRef}/auth/users/user-one/permissions?org_id=org-one'],
      ['GET', '/v1/projects/{projectRef}/auth/users/user-one/passkeys'],
    ]);
  });
});
