import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';
import { readFileSync } from 'node:fs';
import type { AdminPrincipal } from '../auth/admin-permissions.js';
import { withAdminRequestContext } from '../auth/request-context.js';
import { loadConfig } from '../config/index.js';

describe('SupaCloud Management API facade routes', () => {
  const originalFetch = globalThis.fetch;
  const originalBffSigningSecret = process.env.SUPAOAUTH_BFF_SIGNING_SECRET;
  const bffSigningSecret = 'test-bff-signing-secret-0123456789abcdef';
  const adminPrincipal: AdminPrincipal = {
    id: 'facade-test-admin',
    email: 'facade-test-admin@example.test',
    name: 'Facade Test Admin',
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
    if (originalBffSigningSecret === undefined) delete process.env.SUPAOAUTH_BFF_SIGNING_SECRET;
    else process.env.SUPAOAUTH_BFF_SIGNING_SECRET = originalBffSigningSecret;
  });

  it('leaves organization and RBAC mutation webhooks to the SupaCloud transactional outbox', () => {
    for (const route of ['organizations.ts', 'roles.ts']) {
      const source = readFileSync(new URL(`../routes/${route}`, import.meta.url), 'utf8');
      expect(source).not.toContain('repositories/webhook-delivery');
      expect(source).not.toContain('dispatchEvent');
    }
  });

  it('proxies organization, RBAC, audit, webhook, and user management reads to SupaCloud', async () => {
    const [
      { organizationRoutes },
      { roleRoutes },
      { auditRoutes },
      { webhookRoutes },
      { userRoutes },
    ] = await Promise.all([
      import('../routes/organizations.js'),
      import('../routes/roles.js'),
      import('../routes/audit.js'),
      import('../routes/webhooks.js'),
      import('../routes/users.js'),
    ]);
    const app = new Elysia()
      .use(organizationRoutes)
      .use(roleRoutes)
      .use(auditRoutes)
      .use(webhookRoutes)
      .use(userRoutes);

    const requests = [
      'http://supauth.local/v1/organizations',
      'http://supauth.local/v1/roles',
      'http://supauth.local/v1/roles/role-one/assign',
      'http://supauth.local/v1/audit?resource_type=user&limit=5',
      'http://supauth.local/v1/webhooks',
      'http://supauth.local/v1/users/user-one/roles?application_id=app-one',
      'http://supauth.local/v1/users/user-one/permissions?org_id=org-one&application_id=app-one',
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
      ['GET', '/v1/projects/{projectRef}/rbac/roles/role-one/assign'],
      ['GET', '/v1/projects/{projectRef}/audit?resource_type=user&limit=5'],
      ['GET', '/v1/projects/{projectRef}/webhooks'],
      ['GET', '/v1/projects/{projectRef}/auth/users/user-one/roles?application_id=app-one'],
      ['GET', '/v1/projects/{projectRef}/auth/users/user-one/permissions?org_id=org-one&application_id=app-one'],
    ]);
  });

  it('accepts an organization invitation with only the authenticated GoTrue bearer and token', async () => {
    const observed: Array<{ path: string; authorization: string | null; body: string | null }> = [];
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      observed.push({
        path: new URL(url).pathname,
        authorization: new Headers(init?.headers).get('authorization'),
        body: typeof init?.body === 'string' ? init.body : null,
      });
      if (new URL(url).pathname.endsWith('/invitations/invite-one/accept')) {
        return Promise.resolve(Response.json({ id: 'member-one', user_id: 'gotrue-user' }));
      }
      return Promise.resolve(Response.json({ ok: true }));
    }) as unknown as typeof fetch;

    const [{ publicOrganizationRoutes }, { observabilityMiddleware }] = await Promise.all([
      import('../routes/organizations.js'),
      import('../middleware/index.js'),
    ]);
    const app = new Elysia().use(observabilityMiddleware).use(publicOrganizationRoutes);
    const response = await app.handle(new Request(
      'http://supauth.local/v1/organizations/org-one/invitations/invite-one/accept',
      {
        method: 'POST',
        headers: { authorization: 'bearer gotrue-user-token', 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'one-time-token' }),
      },
    ));

    expect(response.status).toBe(200);
    const acceptance = observed.find(({ path }) => path.endsWith('/invitations/invite-one/accept'));
    expect({
      ...acceptance,
      path: acceptance?.path.replace(/\/v1\/projects\/[^/]+/, '/v1/projects/{projectRef}'),
    }).toEqual({
      path: '/v1/projects/{projectRef}/organizations/org-one/invitations/invite-one/accept',
      authorization: 'Bearer gotrue-user-token',
      body: '{"token":"one-time-token"}',
    });
    expect(acceptance?.body).not.toContain('user_id');
  });

  it('rejects invitation acceptance without a GoTrue bearer before platform access', async () => {
    const [{ publicOrganizationRoutes }, { observabilityMiddleware }] = await Promise.all([
      import('../routes/organizations.js'),
      import('../middleware/index.js'),
    ]);
    const app = new Elysia().use(observabilityMiddleware).use(publicOrganizationRoutes);
    const response = await app.handle(new Request(
      'http://supauth.local/v1/organizations/org-one/invitations/invite-one/accept',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'one-time-token' }),
      },
    ));

    expect(response.status).toBe(401);
    const body = await response.json() as any;
    expect(body.error.code).toBe('gotrue_access_token_required');
    expect(calls).toHaveLength(0);
  });

  it('never forwards a browser-supplied invitation user ID to the platform', async () => {
    const { publicOrganizationRoutes } = await import('../routes/organizations.js');
    const app = new Elysia().use(publicOrganizationRoutes);
    const response = await app.handle(new Request(
      'http://supauth.local/v1/organizations/org-one/invitations/invite-one/accept',
      {
        method: 'POST',
        headers: { authorization: 'Bearer gotrue-user-token', 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'one-time-token', user_id: 'forged-user' }),
      },
    ));

    expect(response.ok).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toBe('{"token":"one-time-token"}');
    expect(calls[0]?.body).not.toContain('user_id');
  });

  it('proxies safe user profile updates while preserving SupaOAuth metadata', async () => {
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({
        url,
        method: init?.method || 'GET',
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      const pathname = new URL(url).pathname;
      if ((init?.method || 'GET') === 'GET' && pathname.endsWith('/auth/users/user-one')) {
        return Promise.resolve(Response.json({
          id: 'user-one',
          app_metadata: {
            provider: 'old-provider',
            supaoauth: { roles: ['viewer'], permissions_count: 1 },
          },
        }));
      }
      return Promise.resolve(Response.json({ id: 'one' }));
    }) as unknown as typeof fetch;

    const { userRoutes } = await import('../routes/users.js');
    const app = new Elysia().use(userRoutes);

    const response = await withAdminRequestContext(
      { requestId: 'user-profile-update-request', principal: adminPrincipal },
      () => app.handle(new Request('http://supauth.local/v1/users/user-one', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'safe@example.test',
          user_metadata: { name: 'Safe User' },
          app_metadata: { provider: 'email', providers: ['email'] },
        }),
      })),
    );

    expect(response.status).toBe(200);
    const readCalls = calls.filter((call) => {
      const path = new URL(call.url).pathname.replace(/\/v1\/projects\/[^/]+/, '/v1/projects/{projectRef}');
      return call.method === 'GET' && path === '/v1/projects/{projectRef}/auth/users/user-one';
    });
    const updateCalls = calls.filter((call) => {
      const path = new URL(call.url).pathname.replace(/\/v1\/projects\/[^/]+/, '/v1/projects/{projectRef}');
      return call.method === 'PUT' && path === '/v1/projects/{projectRef}/auth/users/user-one';
    });
    expect(readCalls).toHaveLength(1);
    expect(updateCalls).toHaveLength(1);
    expect(new URL(updateCalls[0]?.url || '').pathname.replace(/\/v1\/projects\/[^/]+/, '/v1/projects/{projectRef}')).toBe(
      '/v1/projects/{projectRef}/auth/users/user-one',
    );
    expect(JSON.parse(updateCalls[0]?.body || '{}')).toEqual({
      email: 'safe@example.test',
      user_metadata: { name: 'Safe User' },
      app_metadata: {
        provider: 'email',
        providers: ['email'],
        supaoauth: { roles: ['viewer'], permissions_count: 1 },
      },
    });
  });

  it('uses server-generated webhook test payloads only', async () => {
    const { webhookRoutes } = await import('../routes/webhooks.js');
    const app = new Elysia().use(webhookRoutes);
    const accepted = await app.handle(new Request('http://supauth.local/v1/webhooks/wh-one/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }));
    const rejected = await app.handle(new Request('http://supauth.local/v1/webhooks/wh-one/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'user.created', payload: { user_id: 'attacker' } }),
    }));

    expect(accepted.status).toBe(200);
    expect(rejected.status).toBe(400);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]?.url || '').pathname).toEndWith('/webhooks/wh-one/test');
    expect(calls[0]?.body).toBe('{}');
  });

  it('keeps the webhook event list compatible while exposing delivery guarantees', async () => {
    const { webhookRoutes } = await import('../routes/webhooks.js');
    const app = new Elysia().use(webhookRoutes);

    const response = await app.handle(new Request('http://supauth.local/v1/webhooks/events'));
    const body = await response.json() as {
      events: string[];
      catalog: Array<{ type: string; guarantee: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.events).toContain('organization.created');
    expect(body.catalog.find((entry) => entry.type === 'organization.created')?.guarantee).toBe('transactional');
    expect(body.catalog.find((entry) => entry.type === 'organization.member_updated')?.guarantee).toBe('transactional');
    expect(body.catalog.find((entry) => entry.type === 'user.created')?.guarantee).toBe('post_mutation');
    expect(body.events).not.toContain('user.signed_in');
    expect(calls).toHaveLength(0);
  });

  it('rejects unsupported events on both webhook creation and update', async () => {
    const { webhookRoutes } = await import('../routes/webhooks.js');
    const app = new Elysia().use(webhookRoutes);
    const invalidPayload = JSON.stringify({ events: ['user.signed_in'] });

    const created = await app.handle(new Request('http://supauth.local/v1/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: invalidPayload,
    }));
    const updated = await app.handle(new Request('http://supauth.local/v1/webhooks/wh-one', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: invalidPayload,
    }));

    expect(created.status).toBe(400);
    expect(updated.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('accepts user application-scoped roles and rejects organization-only targets', async () => {
    const { roleRoutes } = await import('../routes/roles.js');
    const app = new Elysia().use(roleRoutes);
    const invalid = await app.handle(new Request('http://supauth.local/v1/roles/role-one/assign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organization_id: 'org-one' }),
    }));
    expect(invalid.status).toBe(400);
    expect(calls).toHaveLength(0);

    const valid = await withAdminRequestContext(
      { requestId: 'role-assignment-request', principal: adminPrincipal },
      () => app.handle(new Request('http://supauth.local/v1/roles/role-one/assign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: 'user-one', application_id: 'app-one', organization_id: 'org-one' }),
      })),
    );

    expect(valid.status).toBe(200);
    expect(calls.slice(0, 4).map(call => [
      call.method,
      new URL(call.url).pathname.replace(/\/v1\/projects\/[^/]+/, '/v1/projects/{projectRef}'),
    ])).toEqual([
      ['GET', '/v1/projects/{projectRef}/auth/users/user-one'],
      ['GET', '/v1/projects/{projectRef}/organizations/org-one'],
      ['GET', '/v1/projects/{projectRef}/auth/oauth-clients/app-one'],
      ['POST', '/v1/projects/{projectRef}/rbac/roles/role-one/assign'],
    ]);
  });

  it('creates inline role permissions through authoritative mutations and readback', async () => {
    const longPermission = 'p'.repeat(255);
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const pathname = new URL(url).pathname;
      calls.push({
        url,
        method: init?.method || 'GET',
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      if (init?.method === 'POST' && pathname.endsWith('/rbac/roles')) {
        return Promise.resolve(Response.json({ id: 'role-one', name: 'Custom role', permissions: [] }));
      }
      if (init?.method === 'POST' && pathname.endsWith('/rbac/roles/role-one/permissions')) {
        const permission = JSON.parse(String(init.body)) as { name: string };
        return Promise.resolve(Response.json({ id: `permission-${permission.name.length}`, name: permission.name }));
      }
      if ((init?.method || 'GET') === 'GET' && pathname.endsWith('/rbac/roles/role-one')) {
        return Promise.resolve(Response.json({
          id: 'role-one',
          name: 'Custom role',
          permissions: [{ id: 'permission-long', name: longPermission }, { id: 'permission-short', name: 'custom.manage' }],
        }));
      }
      return Promise.resolve(Response.json({ id: 'audit-one' }));
    }) as unknown as typeof fetch;
    const [{ roleRoutes }, { observabilityMiddleware }] = await Promise.all([
      import('../routes/roles.js'),
      import('../middleware/index.js'),
    ]);
    const app = new Elysia().use(observabilityMiddleware).use(roleRoutes);

    const response = await withAdminRequestContext(
      { requestId: 'inline-role-permissions-request', principal: adminPrincipal },
      () => app.handle(new Request('http://supauth.local/v1/roles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: '  Custom role  ',
          description: 'Custom permissions remain supported',
          permissions: [' custom.manage ', ` ${longPermission} `],
          ignored_upstream_field: 'must-not-be-forwarded',
        }),
      })),
    );

    expect(response.status).toBe(200);
    expect((await response.json() as { permissions: Array<{ name: string }> }).permissions.map(permission => permission.name))
      .toEqual([longPermission, 'custom.manage']);
    expect(calls.map(call => [call.method, new URL(call.url).pathname.replace(/\/v1\/projects\/[^/]+/, '/v1/projects/{projectRef}')]))
      .toEqual([
        ['POST', '/v1/projects/{projectRef}/rbac/roles'],
        ['POST', '/v1/projects/{projectRef}/rbac/roles/role-one/permissions'],
        ['POST', '/v1/projects/{projectRef}/rbac/roles/role-one/permissions'],
        ['GET', '/v1/projects/{projectRef}/rbac/roles/role-one'],
        ['POST', '/v1/projects/{projectRef}/audit/events'],
      ]);
    expect(calls[0]?.body).toBe(JSON.stringify({
      name: 'Custom role',
      description: 'Custom permissions remain supported',
    }));
    expect(calls.slice(1, 3).map(call => call.body)).toEqual([
      JSON.stringify({ name: 'custom.manage' }),
      JSON.stringify({ name: longPermission }),
    ]);
  });

  it('keeps role creation without permissions compatible and applies the 255-character name boundary to updates', async () => {
    const boundaryName = 'r'.repeat(255);
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({
        url,
        method: init?.method || 'GET',
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      const pathname = new URL(url).pathname;
      if (pathname.endsWith('/rbac/roles') || pathname.endsWith('/rbac/roles/role-one')) {
        return Promise.resolve(Response.json({ id: 'role-one', name: boundaryName, permissions: [] }));
      }
      return Promise.resolve(Response.json({ id: 'audit-one' }));
    }) as unknown as typeof fetch;
    const { roleRoutes } = await import('../routes/roles.js');
    const app = new Elysia().use(roleRoutes);

    const created = await withAdminRequestContext(
      { requestId: 'boundary-role-create-request', principal: adminPrincipal },
      () => app.handle(new Request('http://supauth.local/v1/roles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: ` ${boundaryName} `, description: null }),
      })),
    );
    const updated = await withAdminRequestContext(
      { requestId: 'boundary-role-update-request', principal: adminPrincipal },
      () => app.handle(new Request('http://supauth.local/v1/roles/role-one', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: ` ${boundaryName} `, description: null }),
      })),
    );

    expect([created.status, updated.status]).toEqual([200, 200]);
    expect(calls.filter(call => new URL(call.url).pathname.includes('/rbac/')).map(call => [call.method, call.body]))
      .toEqual([
        ['POST', JSON.stringify({ name: boundaryName, description: null })],
        ['PUT', JSON.stringify({ name: boundaryName, description: null })],
      ]);
    expect(calls.some(call => new URL(call.url).pathname.endsWith('/permissions'))).toBe(false);
    expect(calls.some(call => call.method === 'GET')).toBe(false);
  });

  it('rejects invalid role names on create and update before platform or audit access', async () => {
    const [{ roleRoutes }, { observabilityMiddleware }] = await Promise.all([
      import('../routes/roles.js'),
      import('../middleware/index.js'),
    ]);
    const app = new Elysia().use(observabilityMiddleware).use(roleRoutes);
    const invalidNames: unknown[] = [undefined, null, 42, '', '   ', 'x'.repeat(256), 'x'.repeat(500), 'x'.repeat(10_000)];

    for (const name of invalidNames) {
      const methods = name === undefined ? ['POST'] as const : ['POST', 'PUT'] as const;
      for (const method of methods) {
        calls.length = 0;
        const path = method === 'POST' ? '/v1/roles' : '/v1/roles/role-one';
        const response = await app.handle(new Request(`http://supauth.local${path}`, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(name === undefined ? {} : { name }),
        }));
        const payload = await response.json() as { error: { code: string; details: { field: string } } };

        expect(response.status).toBe(400);
        expect(payload.error.code).toBe('invalid_role_input');
        expect(payload.error.details.field).toBe('name');
        expect(calls).toEqual([]);
      }
    }
  });

  it('rejects malformed, blank, oversized, and duplicate inline permissions before role creation', async () => {
    const [{ roleRoutes }, { observabilityMiddleware }] = await Promise.all([
      import('../routes/roles.js'),
      import('../middleware/index.js'),
    ]);
    const app = new Elysia().use(observabilityMiddleware).use(roleRoutes);
    const invalidPermissions: unknown[] = [
      'users.read',
      [42],
      [''],
      ['   '],
      ['p'.repeat(256)],
      ['Manage.Users', ' manage.users '],
    ];

    for (const permissions of invalidPermissions) {
      calls.length = 0;
      const response = await app.handle(new Request('http://supauth.local/v1/roles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Reader', permissions }),
      }));
      const payload = await response.json() as { error: { code: string; details: { field: string } } };

      expect(response.status).toBe(400);
      expect(payload.error.code).toBe('invalid_role_input');
      expect(payload.error.details.field).toBe('permissions');
      expect(calls).toEqual([]);
    }
  });

  it('deletes a newly-created role when an inline permission write fails', async () => {
    let permissionWrites = 0;
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const pathname = new URL(url).pathname;
      calls.push({ url, method: init?.method || 'GET', body: typeof init?.body === 'string' ? init.body : undefined });
      if (init?.method === 'POST' && pathname.endsWith('/rbac/roles')) {
        return Promise.resolve(Response.json({ id: 'role-one', name: 'Reader', permissions: [] }));
      }
      if (init?.method === 'POST' && pathname.endsWith('/permissions')) {
        permissionWrites += 1;
        if (permissionWrites === 2) {
          return Promise.resolve(new Response(JSON.stringify({ code: 'permission_conflict' }), { status: 409 }));
        }
        return Promise.resolve(Response.json({ id: 'permission-one', name: 'users.read' }));
      }
      return Promise.resolve(Response.json({ deleted: true }));
    }) as unknown as typeof fetch;
    const [{ roleRoutes }, { observabilityMiddleware }] = await Promise.all([
      import('../routes/roles.js'),
      import('../middleware/index.js'),
    ]);
    const app = new Elysia().use(observabilityMiddleware).use(roleRoutes);

    const response = await app.handle(new Request('http://supauth.local/v1/roles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Reader', permissions: ['users.read', 'users.write'] }),
    }));
    const payload = await response.json() as { error: { code: string } };

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('supacloud_upstream_error');
    expect(calls.map(call => call.method)).toEqual(['POST', 'POST', 'POST', 'DELETE']);
    expect(new URL(calls.at(-1)?.url || '').pathname).toEndWith('/rbac/roles/role-one');
    expect(calls.some(call => new URL(call.url).pathname.endsWith('/audit/events'))).toBe(false);
  });

  it('fails closed on role permission readback mismatch and reports an unknown outcome when rollback fails', async () => {
    let rollbackFails = false;
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const pathname = new URL(url).pathname;
      calls.push({ url, method: init?.method || 'GET', body: typeof init?.body === 'string' ? init.body : undefined });
      if (init?.method === 'POST' && pathname.endsWith('/rbac/roles')) {
        return Promise.resolve(Response.json({ id: 'role-one', name: 'Reader', permissions: [] }));
      }
      if (init?.method === 'POST' && pathname.endsWith('/permissions')) {
        return Promise.resolve(Response.json({ id: 'permission-one', name: 'users.read' }));
      }
      if (init?.method === 'GET') {
        return Promise.resolve(Response.json({ id: 'role-one', name: 'Reader', permissions: [] }));
      }
      if (rollbackFails) {
        return Promise.resolve(new Response(JSON.stringify({ code: 'delete_unavailable' }), { status: 503 }));
      }
      return Promise.resolve(Response.json({ deleted: true }));
    }) as unknown as typeof fetch;
    const [{ roleRoutes }, { observabilityMiddleware }] = await Promise.all([
      import('../routes/roles.js'),
      import('../middleware/index.js'),
    ]);
    const app = new Elysia().use(observabilityMiddleware).use(roleRoutes);

    for (const expected of [
      { rollbackFailure: false, status: 502, code: 'role_permissions_readback_mismatch' },
      { rollbackFailure: true, status: 503, code: 'role_creation_outcome_unknown' },
    ]) {
      rollbackFails = expected.rollbackFailure;
      calls.length = 0;
      const response = await app.handle(new Request('http://supauth.local/v1/roles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Reader', permissions: ['users.read'] }),
      }));
      const payload = await response.json() as { error: { code: string } };

      expect(response.status).toBe(expected.status);
      expect(payload.error.code).toBe(expected.code);
      expect(calls.map(call => call.method)).toEqual(['POST', 'POST', 'GET', 'DELETE']);
      expect(calls.some(call => new URL(call.url).pathname.endsWith('/audit/events'))).toBe(false);
    }
  });

  it('rejects generic user updates that try to write roles or SupaOAuth claims', async () => {
    const { userRoutes } = await import('../routes/users.js');
    const app = new Elysia().use(userRoutes);

    const response = await app.handle(new Request('http://supauth.local/v1/users/user-one', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'attacker@example.test',
        role: 'admin',
        app_metadata: {
          role: 'admin',
          supaoauth: {
            roles: ['admin'],
            permissions: Array.from({ length: 300 }, (_, index) => `permission.${index}`),
          },
        },
      }),
    }));
    const payload = await response.json() as {
      success: boolean;
      error: { code: string; fields?: string[] };
    };

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.error.code).toBe('reserved_user_update_field');
    expect(payload.error.fields).toEqual(['role', 'app_metadata.role', 'app_metadata.supaoauth']);
    expect(calls).toEqual([]);
  });

  it('rejects user creation payloads that attempt to inject runtime roles or SupaOAuth metadata', async () => {
    const { userRoutes } = await import('../routes/users.js');
    const app = new Elysia().use(userRoutes);

    const response = await app.handle(new Request('http://supauth.local/v1/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'attacker@example.test',
        password: 'not-logged',
        role: 'service_role',
        app_metadata: {
          role: 'service_role',
          supaoauth: { roles: ['owner'], permissions: ['*'] },
        },
      }),
    }));
    const payload = await response.json() as { error: { code: string; fields: string[] } };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe('reserved_user_create_field');
    expect(payload.error.fields).toContain('role');
    expect(payload.error.fields).toContain('app_metadata.role');
    expect(payload.error.fields).toContain('app_metadata.supaoauth');
    expect(calls).toEqual([]);
  });

  it('rejects invalid user pagination before calling SupaCloud', async () => {
    const [{ userRoutes }, { observabilityMiddleware }] = await Promise.all([
      import('../routes/users.js'),
      import('../middleware/index.js'),
    ]);
    const app = new Elysia().use(observabilityMiddleware).use(userRoutes);
    const invalidQueries = [
      'page=-1',
      'page=0',
      'page=1.5',
      'page=abc',
      'page=9007199254740992',
      'limit=-1',
      'limit=0',
      'limit=1.5',
      'limit=abc',
      'limit=101',
      'limit=999999',
    ];

    for (const query of invalidQueries) {
      calls.length = 0;
      const response = await app.handle(new Request(`http://supauth.local/v1/users?${query}`));
      const payload = await response.json() as {
        success: boolean;
        error: { code: string; details: { field: string; minimum: number; maximum: number } };
      };

      expect(response.status).toBe(400);
      expect(payload.success).toBe(false);
      expect(payload.error.code).toBe('invalid_pagination');
      expect(payload.error.details.minimum).toBe(1);
      expect(calls).toEqual([]);
    }
  });

  it('normalizes supported user pagination and preserves default response metadata', async () => {
    const { userRoutes } = await import('../routes/users.js');
    const app = new Elysia().use(userRoutes);
    const cases = [
      { query: '', page: 1, limit: 50 },
      { query: '?page=1&limit=1', page: 1, limit: 1 },
      { query: `?page=${Number.MAX_SAFE_INTEGER}&limit=100`, page: Number.MAX_SAFE_INTEGER, limit: 100 },
    ];

    for (const testCase of cases) {
      calls.length = 0;
      const response = await app.handle(new Request(`http://supauth.local/v1/users${testCase.query}`));
      const payload = await response.json() as { page: number; limit: number };

      expect(response.status).toBe(200);
      expect(payload.page).toBe(testCase.page);
      expect(payload.limit).toBe(testCase.limit);
      expect(calls).toHaveLength(1);
      const upstreamUrl = new URL(calls[0]?.url || '');
      expect(upstreamUrl.searchParams.get('page')).toBe(String(testCase.page));
      expect(upstreamUrl.searchParams.get('limit')).toBe(String(testCase.limit));
    }
  });

  it('enforces every configured password requirement before creating an administrator user', async () => {
    const [
      { userRoutes },
      { observabilityMiddleware },
      { GOTRUE_PASSWORD_CHARACTER_POLICIES },
    ] = await Promise.all([
      import('../routes/users.js'),
      import('../middleware/index.js'),
      import('../utils/password-policy.js'),
    ]);
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, method: init?.method || 'GET' });
      return Promise.resolve(Response.json({
        password_min_length: 12,
        password_required_characters: GOTRUE_PASSWORD_CHARACTER_POLICIES.strong,
      }));
    }) as unknown as typeof fetch;
    const app = new Elysia().use(observabilityMiddleware).use(userRoutes);
    const invalidPasswords = [
      { password: 'Short1!', code: 'password_too_short' },
      { password: 'abcdefghijkl1!', code: 'password_requires_uppercase' },
      { password: 'ABCDEFGHIJKL1!', code: 'password_requires_lowercase' },
      { password: 'Abcdefghijkl!', code: 'password_requires_number' },
      { password: 'Abcdefghijkl1', code: 'password_requires_symbol' },
    ];

    for (const testCase of invalidPasswords) {
      const response = await app.handle(new Request('http://supauth.local/v1/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new-user@example.test', password: testCase.password }),
      }));
      const payload = await response.json() as { error: { code: string } };

      expect(response.status).toBe(400);
      expect(payload.error.code).toBe(testCase.code);
    }

    expect(calls).toHaveLength(invalidPasswords.length);
    expect(calls.every((call) => call.method === 'GET'
      && new URL(call.url).pathname.endsWith('/config/auth'))).toBe(true);
  });

  it('fails closed when the administrator user password policy cannot be read or parsed', async () => {
    let configResponse: 'malformed' | 'unavailable' = 'malformed';
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, method: init?.method || 'GET' });
      if (configResponse === 'unavailable') {
        return Promise.resolve(new Response(JSON.stringify({ message: 'unavailable' }), { status: 503 }));
      }
      return Promise.resolve(Response.json({
        password_min_length: 5,
        password_required_characters: '',
      }));
    }) as unknown as typeof fetch;
    const [{ userRoutes }, { observabilityMiddleware }] = await Promise.all([
      import('../routes/users.js'),
      import('../middleware/index.js'),
    ]);
    const app = new Elysia().use(observabilityMiddleware).use(userRoutes);

    for (const failureMode of ['malformed', 'unavailable'] as const) {
      configResponse = failureMode;
      calls.length = 0;
      const response = await app.handle(new Request('http://supauth.local/v1/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new-user@example.test', password: 'Abcdefghi1!x' }),
      }));
      const payload = await response.json() as { error: { code: string } };

      expect(response.status).toBe(503);
      expect(payload.error.code).toBe('password_policy_unavailable');
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe('GET');
      expect(new URL(calls[0]?.url || '').pathname).toEndWith('/config/auth');
    }
  });

  it('creates users at the configured password boundary and skips policy reads without a password', async () => {
    const configPaths: string[] = [];
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method || 'GET';
      const pathname = new URL(url).pathname;
      calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
      if (pathname.endsWith('/config/auth')) {
        configPaths.push(pathname);
        return Promise.resolve(Response.json({
          password_min_length: 12,
          password_required_characters: 'abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789',
        }));
      }
      if (method === 'POST' && pathname.endsWith('/auth/users')) {
        return Promise.resolve(Response.json({ id: 'created-user' }));
      }
      return Promise.resolve(Response.json({ ok: true }));
    }) as unknown as typeof fetch;
    const { userRoutes } = await import('../routes/users.js');
    const app = new Elysia().use(userRoutes);

    const passwordResponse = await withAdminRequestContext(
      { requestId: 'user-create-with-password', principal: adminPrincipal },
      () => app.handle(new Request('http://supauth.local/v1/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'password-user@example.test', password: 'Abcdefghij12' }),
      })),
    );
    expect(passwordResponse.status).toBe(200);
    expect(configPaths).toHaveLength(1);
    expect(calls.filter((call) => call.method === 'POST'
      && new URL(call.url).pathname.endsWith('/auth/users'))).toHaveLength(1);

    calls.length = 0;
    configPaths.length = 0;
    const passwordlessResponse = await withAdminRequestContext(
      { requestId: 'user-create-without-password', principal: adminPrincipal },
      () => app.handle(new Request('http://supauth.local/v1/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'passwordless-user@example.test', email_confirm: true }),
      })),
    );
    expect(passwordlessResponse.status).toBe(200);
    expect(configPaths).toEqual([]);
    expect(calls.filter((call) => call.method === 'POST'
      && new URL(call.url).pathname.endsWith('/auth/users'))).toHaveLength(1);
  });

  it('looks up a user before deletion and maps only exact missing-user errors to 404', async () => {
    let upstreamStatus = 400;
    let upstreamBody: unknown = { code: 'user_not_found' };
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, method: init?.method || 'GET' });
      return Promise.resolve(new Response(JSON.stringify(upstreamBody), {
        status: upstreamStatus,
        headers: { 'content-type': 'application/json' },
      }));
    }) as unknown as typeof fetch;
    const [{ userRoutes }, { observabilityMiddleware }] = await Promise.all([
      import('../routes/users.js'),
      import('../middleware/index.js'),
    ]);
    const app = new Elysia().use(observabilityMiddleware).use(userRoutes);
    const missingBodies = [
      { code: 'user_not_found' },
      { error_code: 'user_not_found' },
      { error: { code: 'user_not_found' } },
    ];

    for (const body of missingBodies) {
      upstreamStatus = 400;
      upstreamBody = body;
      calls.length = 0;
      const response = await app.handle(new Request('http://supauth.local/v1/users/missing-user', {
        method: 'DELETE',
      }));
      const payload = await response.json() as { error: { code: string } };

      expect(response.status).toBe(404);
      expect(payload.error.code).toBe('not_found');
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe('GET');
    }

    const preservedErrors = [
      { status: 400, body: { code: 'USER_NOT_FOUND' }, expectedStatus: 400, expectedCode: 'supacloud_upstream_error' },
      { status: 401, body: { code: 'user_not_found' }, expectedStatus: 401, expectedCode: 'supacloud_upstream_error' },
      { status: 403, body: { code: 'user_not_found' }, expectedStatus: 403, expectedCode: 'supacloud_upstream_error' },
      { status: 409, body: { code: 'user_not_found' }, expectedStatus: 409, expectedCode: 'supacloud_upstream_error' },
      { status: 422, body: { code: 'user_not_found' }, expectedStatus: 422, expectedCode: 'supacloud_upstream_error' },
      { status: 500, body: { code: 'user_not_found' }, expectedStatus: 503, expectedCode: 'supacloud_upstream_error' },
      { status: 404, body: { code: 'user_not_found' }, expectedStatus: 404, expectedCode: 'not_found' },
    ];
    for (const testCase of preservedErrors) {
      upstreamStatus = testCase.status;
      upstreamBody = testCase.body;
      calls.length = 0;
      const response = await app.handle(new Request('http://supauth.local/v1/users/missing-user', {
        method: 'DELETE',
      }));
      const payload = await response.json() as { error: { code: string } };

      expect(response.status).toBe(testCase.expectedStatus);
      expect(payload.error.code).toBe(testCase.expectedCode);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe('GET');
    }
  });

  it('keeps missing-user update and delete responses aligned at 404', async () => {
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, method: init?.method || 'GET' });
      return Promise.resolve(new Response(JSON.stringify({ code: 'user_not_found' }), {
        status: init?.method === 'DELETE' ? 400 : 404,
        headers: { 'content-type': 'application/json' },
      }));
    }) as unknown as typeof fetch;
    const [{ userRoutes }, { observabilityMiddleware }] = await Promise.all([
      import('../routes/users.js'),
      import('../middleware/index.js'),
    ]);
    const app = new Elysia().use(observabilityMiddleware).use(userRoutes);
    const update = await app.handle(new Request('http://supauth.local/v1/users/missing-user', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'missing-user@example.test' }),
    }));
    const deletion = await app.handle(new Request('http://supauth.local/v1/users/missing-user', {
      method: 'DELETE',
    }));

    expect([update.status, deletion.status]).toEqual([404, 404]);
    expect(calls.map((call) => call.method)).toEqual(['PUT', 'GET']);
  });

  it('deletes an existing user only after the preflight lookup succeeds', async () => {
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method || 'GET';
      calls.push({ url, method });
      return Promise.resolve(Response.json(method === 'GET'
        ? { id: 'existing-user' }
        : { id: 'existing-user', deleted: true }));
    }) as unknown as typeof fetch;
    const [{ userRoutes }, { observabilityMiddleware }] = await Promise.all([
      import('../routes/users.js'),
      import('../middleware/index.js'),
    ]);
    const app = new Elysia().use(observabilityMiddleware).use(userRoutes);

    const response = await withAdminRequestContext(
      { requestId: 'delete-existing-user', principal: adminPrincipal },
      () => app.handle(new Request('http://supauth.local/v1/users/existing-user', {
        method: 'DELETE',
      })),
    );

    expect(response.status).toBe(200);
    expect(calls.slice(0, 2).map((call) => call.method)).toEqual(['GET', 'DELETE']);
  });

  it('retires the header-derived legacy account API without platform access', async () => {
    const { myAccountRoutes } = await import('../routes/my-account.js');
    const app = new Elysia().use(myAccountRoutes);

    const response = await app.handle(new Request('http://supauth.local/v1/my-account/profile', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer gotrue-user-token',
        'x-supaoauth-user-id': 'user-one',
      },
      body: JSON.stringify({ data: { name: 'Safe User' } }),
    }));

    expect(response.status).toBe(501);
    expect(calls).toEqual([]);
  });

  it('keeps unsupported administrator session, identity, and grant mutation routes explicit', async () => {
    const [{ userRoutes }, { consentRoutes }, { observabilityMiddleware }] = await Promise.all([
      import('../routes/users.js'),
      import('../routes/consents.js'),
      import('../middleware/index.js'),
    ]);
    const app = new Elysia().use(observabilityMiddleware).use(userRoutes).use(consentRoutes);
    const requests = [
      new Request('http://supauth.local/v1/users/user-one/sessions'),
      new Request('http://supauth.local/v1/users/user-one/sessions/session-one/revoke', { method: 'POST' }),
      new Request('http://supauth.local/v1/users/user-one/identities/identity-one', { method: 'DELETE' }),
      new Request('http://supauth.local/v1/users/user-one/grants/client-one', { method: 'DELETE' }),
      new Request('http://supauth.local/v1/consents?user_id=user-one'),
    ];

    const responses = await Promise.all(requests.map((request) => app.handle(request)));

    expect(responses.map((response) => response.status)).toEqual([501, 501, 501, 501, 501]);
    for (const response of responses) {
      const payload = await response.json() as { error: { code: string } };
      expect(payload.error.code).toBe('capability_unavailable');
    }
    expect(calls).toEqual([]);
  });

  it('lists authoritative GoTrue grants without forwarding unrelated query parameters', async () => {
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, method: init?.method || 'GET' });
      return Promise.resolve(Response.json({
        items: [{ id: 'grant-one', client_id: 'client-one', client_name: 'Client One', scopes: ['openid'] }],
        total: 1,
        source: 'gotrue',
      }));
    }) as unknown as typeof fetch;
    const { userRoutes } = await import('../routes/users.js');
    const app = new Elysia().use(userRoutes);

    const response = await app.handle(new Request(
      'http://supauth.local/v1/users/user%20one/grants?include_revoked=true&ignored=value',
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [{
        id: 'grant-one',
        client_id: 'client-one',
        client_name: 'Client One',
        scopes: ['openid'],
        source: 'gotrue',
      }],
      total: 1,
      page: 1,
      limit: 50,
    });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]?.url || '').pathname).toEndWith('/auth/users/user%20one/grants');
    expect(new URL(calls[0]?.url || '').search).toBe('?include_revoked=true');
  });

  it('does not expose self-service MFA reset through the my-account route', async () => {
    const { myAccountRoutes } = await import('../routes/my-account.js');
    const app = new Elysia().use(myAccountRoutes);

    const response = await app.handle(new Request('http://supauth.local/v1/my-account/mfa/factor-one/reset', {
      method: 'POST',
      headers: {
        'x-supaoauth-user-id': 'user-one',
      },
    }));

    expect(response.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it('keeps administrator MFA reset in the user governance route', async () => {
    const { userRoutes } = await import('../routes/users.js');
    const app = new Elysia().use(userRoutes);

    const response = await withAdminRequestContext(
      { requestId: 'user-mfa-reset-request', principal: adminPrincipal },
      () => app.handle(new Request('http://supauth.local/v1/users/user-one/mfa/factor-one/reset', {
        method: 'POST',
      })),
    );

    expect(response.status).toBe(200);
    expect(calls.map((call) => {
      const url = new URL(call.url);
      return [call.method, url.pathname.replace(/\/v1\/projects\/[^/]+/, '/v1/projects/{projectRef}')];
    })).toContainEqual([
      'POST',
      '/v1/projects/{projectRef}/auth/users/user-one/mfa/factor-one/reset',
    ]);
  });

  it('does not fall back to global platform organizations when project organizations are absent', async () => {
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

    const { SupaCloudAdapter, SupaCloudApiError } = await import('../supacloud/adapter.js');
    const adapter = new SupaCloudAdapter();
    let failure: unknown;
    try {
      await adapter.listOrganizations();
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(SupaCloudApiError);
    expect((failure as InstanceType<typeof SupaCloudApiError>).status).toBe(404);
    expect(calls.map((call) => new URL(call.url).pathname.replace(/\/v1\/projects\/[^/]+/, '/v1/projects/{projectRef}'))).toEqual([
      '/v1/projects/{projectRef}/organizations',
    ]);
  });

  it('preserves missing audit and webhook facade errors instead of returning empty lists', async () => {
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({
        url,
        method: init?.method || 'GET',
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      return Promise.resolve(new Response(JSON.stringify({ message: 'Route not found', code: '404' }), { status: 404 }));
    }) as unknown as typeof fetch;

    const { SupaCloudAdapter, SupaCloudApiError } = await import('../supacloud/adapter.js');
    const adapter = new SupaCloudAdapter();
    const operations = [
      () => adapter.queryAuditLogs({ limit: 5 }),
      () => adapter.listWebhooks(),
      () => adapter.listWebhookLogs('hook-one', { limit: 5 }),
    ];
    for (const operation of operations) {
      let failure: unknown;
      try {
        await operation();
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(SupaCloudApiError);
      expect((failure as InstanceType<typeof SupaCloudApiError>).status).toBe(404);
    }
    expect(calls.map((call) => new URL(call.url).pathname.replace(/\/v1\/projects\/[^/]+/, '/v1/projects/{projectRef}'))).toEqual([
      '/v1/projects/{projectRef}/audit',
      '/v1/projects/{projectRef}/webhooks',
      '/v1/projects/{projectRef}/webhooks/hook-one/logs',
    ]);
  });
});
