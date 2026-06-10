// Webhook management routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import { SUPPORTED_WEBHOOK_EVENTS } from '../repositories/webhook-delivery.js';
import * as auditRepo from '../repositories/audit.js';

const adapter = getSupaCloudAdapter();

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  try { await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details }); } catch {}
}

function toListResponse(value: unknown) {
  if (Array.isArray(value)) return { items: value, total: value.length };
  if (value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)) {
    const items = (value as { items: unknown[]; total?: unknown }).items;
    return { items, total: typeof (value as { total?: unknown }).total === 'number' ? (value as { total: number }).total : items.length };
  }
  return { items: [], total: 0 };
}

export const webhookRoutes = new Elysia({ prefix: '/v1/webhooks' })
  .get('/', async () => {
    return toListResponse(await adapter.listWebhooks());
  }, {
    detail: { summary: 'List webhooks', tags: ['Webhooks'] },
  })
  .post('/', async ({ body }) => {
    const data = body as { url: string; events: string[]; enabled?: boolean; signing_key_id?: string };
    const invalid = data.events.filter(e => !SUPPORTED_WEBHOOK_EVENTS.includes(e as any) && e !== '*');
    if (invalid.length > 0) {
      return new Response(`Invalid event types: ${invalid.join(', ')}. Supported: ${SUPPORTED_WEBHOOK_EVENTS.join(', ')}, *`, { status: 400 });
    }
    const created = await adapter.createWebhook(data as Record<string, unknown>);
    const record = created as Record<string, unknown>;
    await audit('webhook.create', 'webhook', String(record.id || ''), { url: record.url });
    return created;
  }, {
    detail: { summary: 'Create webhook', tags: ['Webhooks'] },
  })
  .get('/events', () => ({ events: SUPPORTED_WEBHOOK_EVENTS }), {
    detail: { summary: 'List supported webhook events', tags: ['Webhooks'] },
  })
  .get('/:webhookId', async ({ params }) => {
    return adapter.getWebhook(params.webhookId);
  }, {
    detail: { summary: 'Get webhook by ID', tags: ['Webhooks'] },
  })
  .get('/:webhookId/logs', async ({ params, query }) => {
    return toListResponse(await adapter.listWebhookLogs(params.webhookId, { limit: query.limit || 50 }));
  }, {
    detail: { summary: 'List webhook delivery and diagnostic logs', tags: ['Webhooks'] },
  })
  .put('/:webhookId', async ({ params, body }) => {
    const data = body as { url?: string; events?: string[]; enabled?: boolean; signing_key_id?: string };
    const updated = await adapter.updateWebhook(params.webhookId, data as Record<string, unknown>);
    await audit('webhook.update', 'webhook', params.webhookId);
    return updated;
  }, {
    detail: { summary: 'Update webhook', tags: ['Webhooks'] },
  })
  .delete('/:webhookId', async ({ params }) => {
    await adapter.deleteWebhook(params.webhookId);
    await audit('webhook.delete', 'webhook', params.webhookId);
  }, {
    detail: { summary: 'Delete webhook', tags: ['Webhooks'] },
  })
  .post('/:webhookId/rotate-secret', async ({ params }) => {
    const updated = await adapter.rotateWebhookSecret(params.webhookId);
    await audit('webhook.rotate_secret', 'webhook', params.webhookId);
    return updated;
  }, {
    detail: { summary: 'Rotate webhook signing secret', tags: ['Webhooks'] },
  })
  .post('/:webhookId/test', async ({ params, body }) => {
    const data = body as { event?: string; payload?: Record<string, unknown> };
    return adapter.testWebhook(params.webhookId, data as Record<string, unknown>);
  }, {
    detail: { summary: 'Send diagnostic webhook delivery', tags: ['Webhooks'] },
  })
  .post('/:webhookId/replay', async ({ params, body }) => {
    const data = body as { event: string; payload?: Record<string, unknown> };
    return adapter.replayWebhook(params.webhookId, data as Record<string, unknown>);
  }, {
    detail: { summary: 'Replay webhook event payload', tags: ['Webhooks'] },
  });
