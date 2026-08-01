import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { loadConfig } from '../config/index.js';
import { withAdminRequestContext } from '../auth/request-context.js';
import { currentAdminAuditIdentity, logPersistedAdminAudit } from '../repositories/audit.js';

const originalFetch = globalThis.fetch;
const configKeys = [
  'SUPACLOUD_API_URL',
  'SUPACLOUD_MASTER_TOKEN',
  'SUPAOAUTH_BFF_SIGNING_SECRET',
  'PROJECT_REF',
  'OAUTH_RUNTIME_URL',
  'SUPACLOUD_DATABASE_URL',
] as const;
let originalConfig: Partial<Record<(typeof configKeys)[number], string>>;

function adminContext(id: string, requestId: string) {
  return {
    requestId,
    principal: {
      id,
      email: `${id}@example.test`,
      name: id,
      roles: ['admin'],
      permissions: ['security.manage'],
      authorization_source: 'rbac_projection' as const,
    },
  };
}

function auditEvent() {
  return {
    idempotencyKey: '1a6c732b-d2c3-4c77-8c40-70f7943e5093',
    eventType: 'sign_in_experience.custom_ui_uploaded',
    resourceType: 'custom_ui_assets',
    resourceId: '8d4ac999-84d7-4cd1-af50-fd4c02118b22',
    details: { event_id: '1a6c732b-d2c3-4c77-8c40-70f7943e5093' },
  };
}

function deliverPersistedAudit() {
  return logPersistedAdminAudit({
    actorId: 'admin-a',
    requestId: 'request-a',
    authorizationSource: 'rbac_projection',
  }, auditEvent());
}

describe('Custom UI persisted admin audit delivery', () => {
  beforeEach(() => {
    originalConfig = {};
    for (const key of configKeys) {
      if (process.env[key] !== undefined) originalConfig[key] = process.env[key];
      delete process.env[key];
    }
    process.env.SUPACLOUD_API_URL = 'http://supacloud.internal';
    process.env.SUPACLOUD_MASTER_TOKEN = 'master-token';
    process.env.SUPAOAUTH_BFF_SIGNING_SECRET = 'test-bff-signing-secret-0123456789abcdef';
    process.env.PROJECT_REF = 'test-project';
    process.env.OAUTH_RUNTIME_URL = 'http://runtime.internal';
    process.env.SUPACLOUD_DATABASE_URL = 'postgres://test';
    loadConfig();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const key of configKeys) {
      if (originalConfig[key] === undefined) delete process.env[key];
      else process.env[key] = originalConfig[key];
    }
    loadConfig();
  });

  it('captures only a trusted current admin identity', () => {
    expect(() => currentAdminAuditIdentity()).toThrow('trusted admin request context');
    expect(() => withAdminRequestContext(
      adminContext('invalid actor', 'request-a'),
      currentAdminAuditIdentity,
    )).toThrow('persistable admin actor ID');
    expect(() => withAdminRequestContext(
      adminContext('admin-a', 'invalid request'),
      currentAdminAuditIdentity,
    )).toThrow('persistable admin request ID');
    const identity = withAdminRequestContext(adminContext('admin-a', 'request-a'), currentAdminAuditIdentity);
    expect(identity).toEqual({
      actorId: 'admin-a',
      requestId: 'request-a',
      authorizationSource: 'rbac_projection',
    });
  });

  it('replays with the persisted actor even inside another admin request', async () => {
    let requestBody = '';
    let requestHeaders = new Headers();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      requestBody = String(init?.body || '{}');
      requestHeaders = new Headers(init?.headers);
      return Promise.resolve(Response.json({ id: 'audit-one' }));
    }) as unknown as typeof fetch;

    const delivery = await withAdminRequestContext(adminContext('admin-b', 'request-b'), () => (
      logPersistedAdminAudit({
        actorId: 'admin-a',
        requestId: 'request-a',
        authorizationSource: 'rbac_projection',
      }, auditEvent())
    ));

    expect(delivery).toBe('delivered');
    expect(JSON.parse(requestBody)).toMatchObject({ actor_id: 'admin-a', actor_type: 'admin' });
    expect(requestHeaders.get('x-request-id')).toBe('request-a');
    expect(requestHeaders.get('x-supaoauth-actor-id')).toBe('admin-a');
    expect(requestHeaders.get('idempotency-key')).toBe('1a6c732b-d2c3-4c77-8c40-70f7943e5093');
  });

  it('rejects an invalid durable idempotency key before transport', async () => {
    const fetchMock = mock(() => Promise.resolve(Response.json({ id: 'unexpected-audit' })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(logPersistedAdminAudit({
      actorId: 'admin-a',
      requestId: 'request-a',
      authorizationSource: 'rbac_projection',
    }, { ...auditEvent(), idempotencyKey: '../not-a-uuid' })).rejects.toThrow('UUID audit idempotency key');
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('classifies every explicit 4xx response as a rejected delivery', async () => {
    for (const status of [400, 405, 418, 429]) {
      globalThis.fetch = mock(() => Promise.resolve(Response.json(
        { error: 'audit_rejected' },
        { status },
      ))) as unknown as typeof fetch;

      await expect(deliverPersistedAudit()).resolves.toBe('rejected');
    }
  });

  it('preserves unknown delivery outcomes for 5xx responses and transport failures', async () => {
    for (const status of [500, 503]) {
      globalThis.fetch = mock(() => Promise.resolve(Response.json(
        { error: 'audit_unavailable' },
        { status },
      ))) as unknown as typeof fetch;

      await expect(deliverPersistedAudit()).rejects.toMatchObject({
        name: 'SupaCloudApiError',
        status,
      });
    }

    const transportFailures = [
      new Error('response lost'),
      Object.assign(new TypeError('request timed out'), { status: 408 }),
      Object.assign(new TypeError('transport rate limited'), { status: 429 }),
    ];
    for (const failure of transportFailures) {
      globalThis.fetch = mock(() => Promise.reject(failure)) as unknown as typeof fetch;
      await expect(deliverPersistedAudit()).rejects.toBe(failure);
    }
  });
});
