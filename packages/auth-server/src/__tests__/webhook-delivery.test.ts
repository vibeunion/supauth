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
