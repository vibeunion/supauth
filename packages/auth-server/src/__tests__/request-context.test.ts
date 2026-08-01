import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { createHash, createHmac } from 'node:crypto';
import { loadConfig } from '../config/index.js';
import type { AdminPrincipal } from '../auth/admin-permissions.js';
import { withAdminRequestContext, withRequestContext } from '../auth/request-context.js';
import { logAudit } from '../repositories/audit.js';
import { SupaCloudAdapter } from '../supacloud/adapter.js';

const originalFetch = globalThis.fetch;
const bffSigningSecret = 'test-bff-signing-secret-0123456789abcdef';
const emptyBodySha256 = createHash('sha256').update(Buffer.alloc(0)).digest('hex');
const isolatedConfigKeys = [
  'SUPACLOUD_API_URL',
  'SUPACLOUD_INTERNAL_API_URL',
  'SUPACLOUD_MANAGEMENT_API_URL',
  'SUPACLOUD_INTERNAL_SUPABASE_URL',
  'SUPACLOUD_MASTER_TOKEN',
  'SUPACLOUD_INTERNAL_TOKEN',
  'SUPACLOUD_SERVICE_TOKEN',
  'SUPAOAUTH_BFF_SIGNING_SECRET',
  'PROJECT_REF',
  'SUPACLOUD_PROJECT_REF',
  'SUPABASE_PROJECT_REF',
  'OAUTH_RUNTIME_URL',
  'SUPACLOUD_RUNTIME_URL',
  'SUPABASE_URL',
  'DATABASE_URL',
  'SUPACLOUD_DATABASE_URL',
  'SUPABASE_DB_URL',
] as const;
let originalConfigEnv: Partial<Record<(typeof isolatedConfigKeys)[number], string>>;

function principal(id: string): AdminPrincipal {
  return {
    id,
    email: `${id}@example.test`,
    name: id,
    roles: ['admin'],
    permissions: ['*'],
    authorization_source: 'rbac_projection',
  };
}

function expectValidBffSignature(
  headers: Headers,
  method: string,
  path: string,
  requestBody: string,
): void {
  const bodySha256 = createHash('sha256').update(Buffer.from(requestBody)).digest('hex');
  const canonical = [
    method,
    path,
    headers.get('x-supaoauth-actor-timestamp'),
    headers.get('x-request-id'),
    headers.get('x-supaoauth-actor-id'),
    headers.get('x-supaoauth-actor-type'),
    bodySha256,
    headers.get('x-supaoauth-actor-nonce'),
  ].join('\n');
  expect(headers.get('x-supaoauth-body-sha256')).toBe(bodySha256);
  expect(headers.get('x-supaoauth-actor-signature')).toBe(
    `v2=${createHmac('sha256', bffSigningSecret).update(canonical).digest('hex')}`,
  );
}

describe('admin request context propagation', () => {
  beforeEach(() => {
    originalConfigEnv = {};
    for (const key of isolatedConfigKeys) {
      if (process.env[key] !== undefined) originalConfigEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.SUPACLOUD_API_URL = 'http://supacloud.internal';
    process.env.SUPACLOUD_MASTER_TOKEN = 'master-token';
    process.env.SUPAOAUTH_BFF_SIGNING_SECRET = bffSigningSecret;
    process.env.PROJECT_REF = 'test-project';
    process.env.OAUTH_RUNTIME_URL = 'http://runtime.internal';
    process.env.SUPACLOUD_DATABASE_URL = 'postgres://test';
    loadConfig();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const key of isolatedConfigKeys) {
      const value = originalConfigEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('keeps concurrent actor and request IDs isolated', async () => {
    const delegatedHeaders: Array<Record<string, string | null>> = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const url = new URL(String(input));
      delegatedHeaders.push({
        actor: headers.get('x-supaoauth-actor-id'),
        request: headers.get('x-request-id'),
        timestamp: headers.get('x-supaoauth-actor-timestamp'),
        bodySha256: headers.get('x-supaoauth-body-sha256'),
        nonce: headers.get('x-supaoauth-actor-nonce'),
        signature: headers.get('x-supaoauth-actor-signature'),
        path: `${url.pathname}${url.search}`,
        method: init?.method || 'GET',
      });
      await new Promise(resolve => setTimeout(resolve, headers.get('x-supaoauth-actor-id') === 'admin-a' ? 5 : 0));
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;

    const adapter = new SupaCloudAdapter();
    await Promise.all([
      withAdminRequestContext({ requestId: 'request-a', principal: principal('admin-a') }, () => adapter.getProject()),
      withAdminRequestContext({ requestId: 'request-b', principal: principal('admin-b') }, () => adapter.getProject()),
    ]);

    for (const expected of [
      { actor: 'admin-a', request: 'request-a' },
      { actor: 'admin-b', request: 'request-b' },
    ]) {
      const observed = delegatedHeaders.find((entry) => entry.actor === expected.actor);
      expect(observed?.request).toBe(expected.request);
      expect(observed?.method).toBe('GET');
      expect(observed?.path).toBe('/v1/projects/test-project');
      const canonical = [
        observed?.method,
        observed?.path,
        observed?.timestamp,
        expected.request,
        expected.actor,
        'admin',
        observed?.bodySha256,
        observed?.nonce,
      ].join('\n');
      expect(observed?.bodySha256).toBe(emptyBodySha256);
      expect(observed?.nonce).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
      expect(observed?.signature).toBe(`v2=${createHmac('sha256', bffSigningSecret).update(canonical).digest('hex')}`);
    }
  });

  it('prevents caller headers from replacing master authorization or delegated actor', async () => {
    let observedHeaders = new Headers();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      observedHeaders = new Headers(init?.headers);
      return Promise.resolve(Response.json({ ok: true }));
    }) as unknown as typeof fetch;

    const adapter = new SupaCloudAdapter() as unknown as {
      masterToken: string;
      request(path: string, options: RequestInit): Promise<unknown>;
    };
    const trustedAuthorization = `Bearer ${adapter.masterToken}`;
    await withAdminRequestContext({ requestId: 'trusted-request', principal: principal('trusted-admin') }, () => (
      adapter.request('/v1/projects/test-project', {
        headers: {
          Authorization: 'Bearer attacker',
          'x-request-id': 'attacker-request',
          'x-supaoauth-actor-id': 'attacker',
          'x-supaoauth-actor-type': 'system',
          'x-supaoauth-actor-timestamp': '1',
          'x-supaoauth-body-sha256': 'attacker',
          'x-supaoauth-actor-nonce': 'attacker-nonce-0000000000000000',
          'x-supaoauth-actor-signature': 'v1=attacker',
          'x-supaoauth-authorization-source': 'attacker',
        },
      })
    ));

    expect(observedHeaders.get('authorization')).toBe(trustedAuthorization);
    expect(observedHeaders.get('authorization')).not.toBe('Bearer attacker');
    expect(observedHeaders.get('x-request-id')).toBe('trusted-request');
    expect(observedHeaders.get('x-supaoauth-actor-id')).toBe('trusted-admin');
    expect(observedHeaders.get('x-supaoauth-actor-type')).toBe('admin');
    expect(observedHeaders.get('x-supaoauth-actor-timestamp')).not.toBe('1');
    expect(observedHeaders.get('x-supaoauth-body-sha256')).toBe(emptyBodySha256);
    expect(observedHeaders.get('x-supaoauth-actor-nonce')).not.toBe('attacker-nonce-0000000000000000');
    expect(observedHeaders.get('x-supaoauth-actor-signature')).toMatch(/^v2=[a-f0-9]{64}$/);
    expect(observedHeaders.get('x-supaoauth-authorization-source')).toBe('rbac_projection');
  });

  it('signs the actual HTTP method and path with query parameters', async () => {
    let observedUrl = new URL('http://unused.invalid');
    let observedMethod = '';
    let observedHeaders = new Headers();
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      observedUrl = new URL(String(input));
      observedMethod = init?.method || 'GET';
      observedHeaders = new Headers(init?.headers);
      return Promise.resolve(Response.json({ ok: true }));
    }) as unknown as typeof fetch;

    const adapter = new SupaCloudAdapter() as unknown as {
      request(path: string, options: RequestInit): Promise<unknown>;
    };
    const requestBody = '{"query":"alice bob"}';
    await withAdminRequestContext({ requestId: 'request-query-1', principal: principal('admin-query') }, () => (
      adapter.request('/v1/projects/test-project/users?query=alice%20bob&limit=10', {
        method: 'PATCH',
        body: requestBody,
      })
    ));

    const timestamp = observedHeaders.get('x-supaoauth-actor-timestamp');
    const bodySha256 = createHash('sha256').update(Buffer.from(requestBody)).digest('hex');
    const nonce = observedHeaders.get('x-supaoauth-actor-nonce');
    const canonical = [
      'PATCH',
      '/v1/projects/test-project/users?query=alice%20bob&limit=10',
      timestamp,
      'request-query-1',
      'admin-query',
      'admin',
      bodySha256,
      nonce,
    ].join('\n');
    const expectedSignature = createHmac('sha256', bffSigningSecret).update(canonical).digest('hex');

    expect(observedMethod).toBe('PATCH');
    expect(`${observedUrl.pathname}${observedUrl.search}`).toBe('/v1/projects/test-project/users?query=alice%20bob&limit=10');
    expect(observedHeaders.get('x-supaoauth-body-sha256')).toBe(bodySha256);
    expect(observedHeaders.get('x-supaoauth-actor-signature')).toBe(`v2=${expectedSignature}`);
  });

  it('uses the authenticated principal and request ID in audit payloads', async () => {
    let auditPayload: Record<string, unknown> = {};
    let auditHeaders = new Headers();
    let requestBody = '';
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      requestBody = String(init?.body || '{}');
      auditPayload = JSON.parse(requestBody) as Record<string, unknown>;
      auditHeaders = new Headers(init?.headers);
      return Promise.resolve(Response.json({ id: 'audit-one' }));
    }) as unknown as typeof fetch;

    await withAdminRequestContext(
      { requestId: 'request-audit-1', principal: principal('admin-audit') },
      () => logAudit({
        eventType: 'resource.update',
        actorId: 'body-user',
        actorType: 'user',
        resourceType: 'resource',
        resourceId: 'resource-one',
      }),
    );

    expect(auditPayload.actor_id).toBe('admin-audit');
    expect(auditPayload.actor_type).toBe('admin');
    expect(auditPayload.details).toMatchObject({
      request_id: 'request-audit-1',
      project_ref: 'test-project',
    });
    expect(auditHeaders.get('x-request-id')).toBe('request-audit-1');
    expect(auditHeaders.get('x-supaoauth-actor-id')).toBe('admin-audit');
    expect(auditHeaders.get('x-supaoauth-actor-type')).toBe('admin');
    expectValidBffSignature(
      auditHeaders,
      'POST',
      '/v1/projects/test-project/audit/events',
      requestBody,
    );
  });

  it('overrides direct audit event body actors with the trusted admin context', async () => {
    let requestBody = '';
    let requestHeaders = new Headers();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      requestBody = String(init?.body || '{}');
      requestHeaders = new Headers(init?.headers);
      return Promise.resolve(Response.json({ id: 'audit-admin' }));
    }) as unknown as typeof fetch;

    const adapter = new SupaCloudAdapter();
    await withAdminRequestContext(
      { requestId: 'request-direct-admin', principal: principal('direct-admin') },
      () => adapter.recordAuditEvent({
        event_type: 'resource.update',
        actor_id: 'body-user',
        actor_type: 'user',
        resource_type: 'resource',
        resource_id: 'resource-one',
      }, '1a6c732b-d2c3-4c77-8c40-70f7943e5093'),
    );

    expect(JSON.parse(requestBody)).toMatchObject({
      actor_id: 'direct-admin',
      actor_type: 'admin',
    });
    expect(requestHeaders.get('idempotency-key')).toBe('1a6c732b-d2c3-4c77-8c40-70f7943e5093');
  });

  it('signs user audit events from a request context without impersonating master', async () => {
    let auditHeaders = new Headers();
    let requestBody = '';
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      auditHeaders = new Headers(init?.headers);
      requestBody = String(init?.body || '{}');
      return Promise.resolve(Response.json({ id: 'audit-user' }));
    }) as unknown as typeof fetch;

    await withRequestContext({ requestId: 'request-user-audit' }, () => logAudit({
      eventType: 'my_account.profile.updated',
      actorId: 'user-one',
      actorType: 'user',
      resourceType: 'user',
      resourceId: 'user-one',
    }));

    const auditPayload = JSON.parse(requestBody) as Record<string, unknown>;
    expect(auditPayload.actor_id).toBe('user-one');
    expect(auditPayload.actor_type).toBe('user');
    expect(auditHeaders.get('authorization')).toBe('Bearer master-token');
    expect(auditHeaders.get('x-request-id')).toBe('request-user-audit');
    expect(auditHeaders.get('x-supaoauth-actor-id')).toBe('user-one');
    expect(auditHeaders.get('x-supaoauth-actor-type')).toBe('user');
    expect(auditHeaders.get('x-supaoauth-authorization-source')).toBe('supaoauth_audit_user');
    expectValidBffSignature(
      auditHeaders,
      'POST',
      '/v1/projects/test-project/audit/events',
      requestBody,
    );
  });

  it('signs background audit events with a stable system actor and safe request ID', async () => {
    let auditHeaders = new Headers();
    let requestBody = '';
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      auditHeaders = new Headers(init?.headers);
      requestBody = String(init?.body || '{}');
      return Promise.resolve(Response.json({ id: 'audit-system' }));
    }) as unknown as typeof fetch;

    await logAudit({
      eventType: 'sync.completed',
      actorId: 'master-token',
      actorType: 'system',
      resourceType: 'sync',
      resourceId: 'sync-one',
    });

    const auditPayload = JSON.parse(requestBody) as Record<string, unknown>;
    expect(auditPayload.actor_id).toBe('supaoauth-system');
    expect(auditPayload.actor_type).toBe('system');
    expect(auditHeaders.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(auditHeaders.get('x-supaoauth-actor-id')).toBe('supaoauth-system');
    expect(auditHeaders.get('x-supaoauth-actor-type')).toBe('system');
    expect(auditHeaders.get('x-supaoauth-authorization-source')).toBe('supaoauth_audit_system');
    expectValidBffSignature(
      auditHeaders,
      'POST',
      '/v1/projects/test-project/audit/events',
      requestBody,
    );
  });

  it('fails before fetch when user or admin audit actor proof is unavailable', async () => {
    let fetchCalls = 0;
    globalThis.fetch = mock(() => {
      fetchCalls += 1;
      return Promise.resolve(Response.json({ id: 'unexpected-audit' }));
    }) as unknown as typeof fetch;

    await expect(logAudit({
      eventType: 'user.event',
      actorType: 'user',
      resourceType: 'user',
      resourceId: 'user-one',
    })).rejects.toThrow('actorId is required for user audit events');
    await expect(logAudit({
      eventType: 'admin.event',
      actorType: 'admin',
      resourceType: 'tenant',
      resourceId: 'test-project',
    })).rejects.toThrow('trusted admin request context');

    const adapter = new SupaCloudAdapter();
    await expect(adapter.recordAuditEvent({
      event_type: 'user.event',
      actor_type: 'user',
      resource_type: 'user',
      resource_id: 'user-one',
    })).rejects.toThrow('actorId is required for user audit events');
    await expect(adapter.recordAuditEvent({
      event_type: 'admin.event',
      actor_type: 'admin',
      resource_type: 'tenant',
      resource_id: 'test-project',
    })).rejects.toThrow('trusted admin request context');
    expect(fetchCalls).toBe(0);
  });

  it('strips delegated actor and proof headers when no trusted context exists', async () => {
    let observedHeaders = new Headers();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      observedHeaders = new Headers(init?.headers);
      return Promise.resolve(Response.json({ ok: true }));
    }) as unknown as typeof fetch;

    const adapter = new SupaCloudAdapter() as unknown as {
      request(path: string, options: RequestInit): Promise<unknown>;
    };
    await adapter.request('/v1/projects/test-project', {
      headers: {
        Authorization: 'Bearer attacker',
        'x-request-id': 'attacker-request',
        'x-supaoauth-actor-id': 'attacker',
        'x-supaoauth-actor-type': 'admin',
        'x-supaoauth-actor-timestamp': '1',
        'x-supaoauth-body-sha256': 'attacker',
        'x-supaoauth-actor-nonce': 'attacker-nonce-0000000000000000',
        'x-supaoauth-actor-signature': 'v1=attacker',
        'x-supaoauth-authorization-source': 'attacker',
      },
    });

    expect(observedHeaders.get('authorization')).toBe('Bearer master-token');
    for (const header of [
      'x-request-id',
      'x-supaoauth-actor-id',
      'x-supaoauth-actor-type',
      'x-supaoauth-actor-timestamp',
      'x-supaoauth-body-sha256',
      'x-supaoauth-actor-nonce',
      'x-supaoauth-actor-signature',
      'x-supaoauth-authorization-source',
    ]) {
      expect(observedHeaders.get(header)).toBeNull();
    }
  });

  it('fails before fetch for invalid delegated proof configuration or request IDs', async () => {
    let fetchCalls = 0;
    globalThis.fetch = mock(() => {
      fetchCalls += 1;
      return Promise.resolve(Response.json({ ok: true }));
    }) as unknown as typeof fetch;

    for (const secret of ['', 'short-secret', 'master-token']) {
      process.env.SUPAOAUTH_BFF_SIGNING_SECRET = secret;
      loadConfig();
      const adapter = new SupaCloudAdapter();
      await expect(withAdminRequestContext(
        { requestId: 'trusted-request', principal: principal('trusted-admin') },
        () => adapter.getProject(),
      )).rejects.toThrow('SUPAOAUTH_BFF_SIGNING_SECRET');
    }

    process.env.SUPAOAUTH_BFF_SIGNING_SECRET = bffSigningSecret;
    loadConfig();
    const adapter = new SupaCloudAdapter();
    await expect(withAdminRequestContext(
      { requestId: 'invalid request id', principal: principal('trusted-admin') },
      () => adapter.getProject(),
    )).rejects.toThrow('Invalid request ID for SupaCloud BFF proof');
    expect(fetchCalls).toBe(0);
  });
});
