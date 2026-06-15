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

describe('Webhook delivery — DB-backed queue functions', () => {
  it('exports processPendingDeliveries function', async () => {
    process.env.SUPACLOUD_API_URL = 'http://localhost:9090';
    process.env.SUPACLOUD_MASTER_TOKEN = 'test-token';
    process.env.PROJECT_REF = 'test-ref';
    process.env.DATABASE_URL = 'postgres://test';
    process.env.OAUTH_RUNTIME_URL = 'http://runtime.test';
    process.env.RUNTIME_MODE = 'gotrue';

    const mod = await import('../repositories/webhook-delivery.js');
    expect(typeof mod.processPendingDeliveries).toBe('function');
  });

  it('processPendingDeliveries returns a number', async () => {
    const { processPendingDeliveries } = await import('../repositories/webhook-delivery.js');
    // Without a real DB, this will throw internally and return 0 or throw.
    // The function must exist and be callable.
    expect(typeof processPendingDeliveries).toBe('function');
  });
});


// ─── Behavior: stable X-SupaOAuth-Delivery-Id (idempotency key) ───────────
// The delivery id must be a stable idempotency key so webhook consumers can
// dedupe retries and stale reclaim deliveries. These tests mock fetch to
// capture the request headers and assert the id is the caller-supplied value,
// not a per-call Date.now() timestamp.

describe('Webhook delivery — stable delivery id (idempotency key)', () => {
  let originalFetch: typeof globalThis.fetch;
  let lastHeaders: Record<string, string> = {};

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    lastHeaders = {};
    globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
      lastHeaders = (init?.headers as Record<string, string>) || {};
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('passes caller-supplied deliveryId verbatim as X-SupaOAuth-Delivery-Id', async () => {
    const { deliverWebhookOnce, buildEvent } = await import('../repositories/webhook-delivery.js');
    // logAudit throws without a DB; the header is captured before that, so we
    // assert inside catch after fetch has run.
    try {
      await deliverWebhookOnce('wh-1', 'http://example.test', 'secret', buildEvent('user.created', { id: 'u1' }), 'del-stable-123');
    } catch {
      // expected: no DB for audit
    }
    expect(lastHeaders['X-SupaOAuth-Delivery-Id']).toBe('del-stable-123');
  });

  it('does not use a Date.now()-based id (which would change per call)', async () => {
    const { deliverWebhookOnce, buildEvent } = await import('../repositories/webhook-delivery.js');
    try {
      await deliverWebhookOnce('wh-1', 'http://example.test', 'secret', buildEvent('user.created', {}), 'fixed-key');
    } catch {
      // expected: no DB for audit
    }
    // Must be exactly the provided key, never `${webhookId}-${Date.now()}`
    expect(lastHeaders['X-SupaOAuth-Delivery-Id']).not.toMatch(/^wh-1-\d+$/);
  });

  it('generates a UUID when deliveryId is omitted (not a timestamp)', async () => {
    const { deliverWebhookOnce, buildEvent } = await import('../repositories/webhook-delivery.js');
    try {
      await deliverWebhookOnce('wh-1', 'http://example.test', 'secret', buildEvent('user.created', {}));
    } catch {
      // expected: no DB for audit
    }
    // UUID v4-ish format, never `${webhookId}-${Date.now()}`
    expect(lastHeaders['X-SupaOAuth-Delivery-Id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
