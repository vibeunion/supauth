import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { withRequestContext } from '../auth/request-context.js';

describe('Webhook delivery — buildEvent', () => {
  it('builds event envelope with stable id, type, and versioned timestamp', async () => {
    process.env.SUPACLOUD_API_URL = 'http://localhost:9090';
    process.env.SUPACLOUD_MASTER_TOKEN = 'test-token';
    process.env.PROJECT_REF = 'test-ref';
    process.env.DATABASE_URL = 'postgres://test';
    process.env.OAUTH_RUNTIME_URL = 'http://runtime.test';
    process.env.RUNTIME_MODE = 'gotrue';

    const { buildEvent } = await import('../repositories/webhook-delivery.js');
    const event = withRequestContext({ requestId: 'build-envelope-request' }, () => (
      buildEvent('user.created', { user_id: 'u1' })
    ));
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.type).toBe('user.created');
    expect(event.payload).toEqual({ user_id: 'u1' });
    expect(event.occurred_at).toBeDefined();
    expect(new Date(event.occurred_at).toISOString()).toBe(event.occurred_at);
    expect(event.api_version).toBe('2026-07-01');
  });

  it('builds event with empty payload', async () => {
    const { buildEvent } = await import('../repositories/webhook-delivery.js');
    const event = withRequestContext({ requestId: 'empty-payload-request' }, () => (
      buildEvent('test.event', {})
    ));
    expect(event.payload).toEqual({});
  });

  it('builds event with nested payload', async () => {
    const { buildEvent } = await import('../repositories/webhook-delivery.js');
    const event = withRequestContext({ requestId: 'nested-payload-request' }, () => (
      buildEvent('organization.created', { name: 'acme', settings: { public: true } })
    ));
    expect(event.payload.name).toBe('acme');
    expect((event.payload as any).settings.public).toBe(true);
  });

  it('derives a stable UUID from request ID and event type for retries', async () => {
    const { buildEvent } = await import('../repositories/webhook-delivery.js');
    const firstId = withRequestContext({ requestId: 'webhook-retry-request' }, () => (
      buildEvent('user.updated', { attempt: 1 }).id
    ));
    const retriedId = withRequestContext({ requestId: 'webhook-retry-request' }, () => (
      buildEvent('user.updated', { attempt: 2 }).id
    ));
    const differentEventId = withRequestContext({ requestId: 'webhook-retry-request' }, () => (
      buildEvent('user.suspended', {}).id
    ));

    expect(retriedId).toBe(firstId);
    expect(differentEventId).not.toBe(firstId);
    expect(firstId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('Webhook delivery — SUPPORTED_WEBHOOK_EVENTS', () => {
  it('includes core user events', async () => {
    process.env.SUPACLOUD_API_URL = 'http://localhost:9090';
    process.env.SUPACLOUD_MASTER_TOKEN = 'test-token';
    process.env.PROJECT_REF = 'test-ref';
    process.env.DATABASE_URL = 'postgres://test';
    process.env.OAUTH_RUNTIME_URL = 'http://runtime.test';
    process.env.RUNTIME_MODE = 'gotrue';

    const { SUPPORTED_WEBHOOK_EVENTS } = await import('../repositories/webhook-delivery.js');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('user.created');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('user.updated');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('user.suspended');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('user.unsuspended');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('user.deleted');
  });

  it('includes application events', async () => {
    const { SUPPORTED_WEBHOOK_EVENTS } = await import('../repositories/webhook-delivery.js');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('application.created');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('application.updated');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('application.deleted');
  });

  it('includes organization events', async () => {
    const { SUPPORTED_WEBHOOK_EVENTS } = await import('../repositories/webhook-delivery.js');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('organization.created');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('organization.invitation_created');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('organization.member_added');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('organization.member_updated');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('organization.member_removed');
  });

  it('includes role events but no unsupported consent events', async () => {
    const { SUPPORTED_WEBHOOK_EVENTS } = await import('../repositories/webhook-delivery.js');
    expect(SUPPORTED_WEBHOOK_EVENTS).not.toContain('consent.granted');
    expect(SUPPORTED_WEBHOOK_EVENTS).not.toContain('consent.revoked');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('role.assigned');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('role.revoked');
  });

  it('includes connector and template events', async () => {
    const { SUPPORTED_WEBHOOK_EVENTS } = await import('../repositories/webhook-delivery.js');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('connector.updated');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('org_template.created');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('organization.created_from_template');
  });

  it('exposes delivery guarantees without legacy unsupported events', async () => {
    const { SUPPORTED_WEBHOOK_EVENTS, WEBHOOK_EVENT_CATALOG } = await import('../repositories/webhook-delivery.js');
    expect(WEBHOOK_EVENT_CATALOG.find((entry) => entry.type === 'organization.member_added')?.guarantee).toBe('transactional');
    expect(WEBHOOK_EVENT_CATALOG.find((entry) => entry.type === 'organization.member_updated')?.guarantee).toBe('transactional');
    expect(WEBHOOK_EVENT_CATALOG.find((entry) => entry.type === 'role.assigned')?.guarantee).toBe('transactional');
    expect(WEBHOOK_EVENT_CATALOG.find((entry) => entry.type === 'user.created')?.guarantee).toBe('post_mutation');
    expect(WEBHOOK_EVENT_CATALOG.find((entry) => entry.type === 'application.created')?.guarantee).toBe('post_mutation');
    expect(WEBHOOK_EVENT_CATALOG.find((entry) => entry.type === 'connector.updated')?.guarantee).toBe('post_mutation');
    expect(WEBHOOK_EVENT_CATALOG.find((entry) => entry.type === 'org_template.created')?.guarantee).toBe('post_mutation');
    expect(SUPPORTED_WEBHOOK_EVENTS).not.toContain('user.signed_in');
    expect(SUPPORTED_WEBHOOK_EVENTS).not.toContain('application.secret_created');
  });

  it('fails closed when no request ID is available for event identity', async () => {
    const { buildEvent } = await import('../repositories/webhook-delivery.js');
    expect(() => buildEvent('user.created', {})).toThrow('active request ID');
  });
});

describe('Webhook delivery — SupaCloud managed pipeline', () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: string; headers?: Headers }> = [];

  beforeEach(() => {
    process.env.SUPACLOUD_INTERNAL_API_URL = 'http://supacloud.internal';
    process.env.SUPACLOUD_INTERNAL_TOKEN = 'test-token';
    process.env.SUPACLOUD_PROJECT_REF = 'test-project';
    process.env.SUPACLOUD_RUNTIME_URL = 'http://runtime.internal';
    process.env.SUPACLOUD_DATABASE_URL = 'postgres://test';
    process.env.RUNTIME_MODE = 'gotrue';
    calls.length = 0;
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({
        url,
        method: init?.method || 'GET',
        body: typeof init?.body === 'string' ? init.body : undefined,
        headers: new Headers(init?.headers),
      });
      return Promise.resolve(Response.json({ queued: true }));
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('submits events to SupaCloud instead of delivering locally', async () => {
    const { buildEvent, dispatchEvent } = await import('../repositories/webhook-delivery.js');
    const event = withRequestContext({ requestId: 'pipeline-request' }, () => (
      buildEvent('application.created', { client_id: 'client-one' })
    ));

    await dispatchEvent(event);

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(calls[0].method).toBe('POST');
    expect(url.pathname.replace(/\/v1\/projects\/[^/]+/, '/v1/projects/{projectRef}')).toBe('/v1/projects/{projectRef}/webhooks/events');
    expect(JSON.parse(calls[0].body || '{}')).toEqual(event);
    expect(calls[0].headers?.get('Idempotency-Key')).toBe(event.id);
  });
});

describe('Webhook delivery — module exports', () => {
  it('exports only the SupaCloud event facade, not a local delivery worker', async () => {
    const mod = await import('../repositories/webhook-delivery.js');
    expect(typeof mod.dispatchEvent).toBe('function');
    expect('processPendingDeliveries' in mod).toBe(false);
    expect('deliverWebhookOnce' in mod).toBe(false);
  });

  it('exports WebhookEvent type (constructor check)', async () => {
    const { buildEvent } = await import('../repositories/webhook-delivery.js');
    const event = withRequestContext({ requestId: 'module-export-request' }, () => buildEvent('test', {}));
    expect(event).toHaveProperty('type');
    expect(event).toHaveProperty('payload');
    expect(event).toHaveProperty('occurred_at');
    expect(event).toHaveProperty('api_version');
  });
});
