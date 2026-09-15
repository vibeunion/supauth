import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';
import { ApiContractError } from '../utils/api-contract.js';

const validWebhook = {
  id: 'webhook-one', url: 'https://example.test/hook', events: ['user.created'],
  enabled: true, secret_configured: true, created_at: '2026-09-08', updated_at: '2026-09-08',
};
let upstream: unknown = validWebhook;
let writes = 0;
const audits: unknown[] = [];
mock.module('../supacloud/adapter.js', () => ({
  getSupaCloudAdapter: () => ({
    createWebhook: async () => { writes++; return upstream; },
  }),
}));
mock.module('../repositories/audit.js', () => ({
  logAudit: async (event: unknown) => { audits.push(event); },
}));
mock.module('../repositories/webhook-delivery.js', () => ({
  SUPPORTED_WEBHOOK_EVENTS: ['user.created'],
  WEBHOOK_EVENT_CATALOG: [{ type: 'user.created', guarantee: 'post_mutation' }],
}));

const { webhookRoutes } = await import('../routes/webhooks.js');
const app = new Elysia()
  .onError(({ error, set }) => {
    if (error instanceof ApiContractError) {
      set.status = error.status;
      return { code: error.code };
    }
    set.status = 500;
    return { code: 'unexpected_error' };
  })
  .use(webhookRoutes);

function createWebhook(body: unknown = { url: validWebhook.url, events: validWebhook.events }) {
  return app.handle(new Request('http://localhost/v1/webhooks', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}

beforeEach(() => { writes = 0; audits.length = 0; upstream = validWebhook; });

describe('validated operation side effects', () => {
  it('does not publish a success audit or replay a write after a malformed upstream receipt', async () => {
    upstream = { ...validWebhook, id: 123, url: { private: 'fixture-private-value' } };
    const response = await createWebhook();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: 'invalid_upstream_response' });
    expect(writes).toBe(1);
    expect(audits).toHaveLength(0);
  });

  it('uses only validated domain fields in the success audit', async () => {
    const response = await createWebhook();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(validWebhook);
    expect(writes).toBe(1);
    expect(audits).toEqual([{
      eventType: 'webhook.create', resourceType: 'webhook', resourceId: validWebhook.id,
      actorType: 'admin', details: { url: validWebhook.url },
    }]);
  });

  it('rejects malformed requests before the mutation boundary', async () => {
    const response = await createWebhook({ url: 1, events: ['user.created'] });
    expect(response.status).toBe(400);
    expect(writes).toBe(0);
    expect(audits).toHaveLength(0);
  });
});
