import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

describe('Webhook delivery — buildEvent', () => {
  it('builds event envelope with type, payload, and timestamp', async () => {
    process.env.SUPACLOUD_API_URL = 'http://localhost:9090';
    process.env.SUPACLOUD_MASTER_TOKEN = 'test-token';
    process.env.PROJECT_REF = 'test-ref';
    process.env.DATABASE_URL = 'postgres://test';
    process.env.OAUTH_RUNTIME_URL = 'http://runtime.test';
    process.env.RUNTIME_MODE = 'gotrue';

    const { buildEvent } = await import('../repositories/webhook-delivery.js');
    const event = buildEvent('user.created', { user_id: 'u1' });
    expect(event.type).toBe('user.created');
    expect(event.payload).toEqual({ user_id: 'u1' });
    expect(event.timestamp).toBeDefined();
    expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
  });

  it('builds event with empty payload', async () => {
    const { buildEvent } = await import('../repositories/webhook-delivery.js');
    const event = buildEvent('test.event', {});
    expect(event.payload).toEqual({});
  });

  it('builds event with nested payload', async () => {
    const { buildEvent } = await import('../repositories/webhook-delivery.js');
    const event = buildEvent('organization.created', { name: 'acme', settings: { public: true } });
    expect(event.payload.name).toBe('acme');
    expect((event.payload as any).settings.public).toBe(true);
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
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('user.signed_in');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('user.deleted');
  });

  it('includes application events', async () => {
    const { SUPPORTED_WEBHOOK_EVENTS } = await import('../repositories/webhook-delivery.js');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('application.created');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('application.updated');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('application.deleted');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('application.secret_created');
  });

  it('includes organization events', async () => {
    const { SUPPORTED_WEBHOOK_EVENTS } = await import('../repositories/webhook-delivery.js');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('organization.created');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('organization.invitation_created');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('organization.member_added');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('organization.member_removed');
  });

  it('includes consent and role events', async () => {
    const { SUPPORTED_WEBHOOK_EVENTS } = await import('../repositories/webhook-delivery.js');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('consent.granted');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('consent.revoked');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('role.assigned');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('role.revoked');
  });

  it('includes connector and template events', async () => {
    const { SUPPORTED_WEBHOOK_EVENTS } = await import('../repositories/webhook-delivery.js');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('connector.updated');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('org_template.created');
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain('organization.created_from_template');
  });

  it('has at least 17 events', async () => {
    const { SUPPORTED_WEBHOOK_EVENTS } = await import('../repositories/webhook-delivery.js');
    expect(SUPPORTED_WEBHOOK_EVENTS.length).toBeGreaterThanOrEqual(17);
  });
});

describe('Webhook delivery — SupaCloud managed pipeline', () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: string }> = [];

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
      });
      return Promise.resolve(Response.json({ queued: true }));
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('submits events to SupaCloud instead of delivering locally', async () => {
    const { buildEvent, dispatchEvent } = await import('../repositories/webhook-delivery.js');
    const event = buildEvent('application.created', { client_id: 'client-one' });

    await dispatchEvent(event);

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(calls[0].method).toBe('POST');
    expect(url.pathname.replace(/\/v1\/projects\/[^/]+/, '/v1/projects/{projectRef}')).toBe('/v1/projects/{projectRef}/webhooks/events');
    expect(JSON.parse(calls[0].body || '{}')).toEqual(event);
  });
});

describe('Webhook delivery — module exports', () => {
  it('exports dispatchEvent function', async () => {
    const mod = await import('../repositories/webhook-delivery.js');
    expect(typeof mod.dispatchEvent).toBe('function');
  });

  it('exports WebhookEvent type (constructor check)', async () => {
    const { buildEvent } = await import('../repositories/webhook-delivery.js');
    const event = buildEvent('test', {});
    expect(event).toHaveProperty('type');
    expect(event).toHaveProperty('payload');
    expect(event).toHaveProperty('timestamp');
  });
});
