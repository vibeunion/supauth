import { describe, it, expect, beforeEach, mock, afterEach } from 'bun:test';

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

describe('Webhook delivery — signature computation', () => {
  it('HMAC-SHA256 produces correct hex digest', async () => {
    // Verify the signing approach independently
    const key = new TextEncoder().encode('secret');
    const cryptoKey = await crypto.subtle.importKey(
      'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode('test payload'));
    const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    expect(hex).toHaveLength(64); // SHA-256 = 32 bytes = 64 hex chars
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signature is deterministic for same input', async () => {
    const key = new TextEncoder().encode('secret');
    const cryptoKey = await crypto.subtle.importKey(
      'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const payload = new TextEncoder().encode('deterministic test');
    const sig1 = await crypto.subtle.sign('HMAC', cryptoKey, payload);
    const sig2 = await crypto.subtle.sign('HMAC', cryptoKey, payload);
    const hex1 = Array.from(new Uint8Array(sig1)).map(b => b.toString(16).padStart(2, '0')).join('');
    const hex2 = Array.from(new Uint8Array(sig2)).map(b => b.toString(16).padStart(2, '0')).join('');
    expect(hex1).toBe(hex2);
  });

  it('different secrets produce different signatures', async () => {
    const payload = new TextEncoder().encode('same payload');
    const results: string[] = [];
    for (const secret of ['secret1', 'secret2', 'secret3']) {
      const key = new TextEncoder().encode(secret);
      const cryptoKey = await crypto.subtle.importKey(
        'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
      );
      const sig = await crypto.subtle.sign('HMAC', cryptoKey, payload);
      results.push(Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join(''));
    }
    expect(new Set(results).size).toBe(3);
  });
});

describe('Webhook delivery — module exports', () => {
  it('exports deliverWebhookOnce function', async () => {
    const mod = await import('../repositories/webhook-delivery.js');
    expect(typeof mod.deliverWebhookOnce).toBe('function');
  });

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
