// Webhook management routes with OpenAPI annotations

import { Elysia } from 'elysia';
import * as webhookRepo from '../repositories/webhooks.js';
import { SUPPORTED_WEBHOOK_EVENTS, buildEvent, deliverWebhookOnce } from '../repositories/webhook-delivery.js';
import * as auditRepo from '../repositories/audit.js';

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  try { await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details }); } catch {}
}

export const webhookRoutes = new Elysia({ prefix: '/v1/webhooks' })
  .get('/', async () => {
    const items = await webhookRepo.listWebhooks();
    return { items, total: items.length };
  }, {
    detail: { summary: 'List webhooks', tags: ['Webhooks'] },
  })
  .post('/', async ({ body }) => {
    const data = body as { url: string; events: string[]; enabled?: boolean; signing_key_id?: string };
    const invalid = data.events.filter(e => !SUPPORTED_WEBHOOK_EVENTS.includes(e as any) && e !== '*');
    if (invalid.length > 0) {
      return new Response(`Invalid event types: ${invalid.join(', ')}. Supported: ${SUPPORTED_WEBHOOK_EVENTS.join(', ')}, *`, { status: 400 });
    }
    const created = await webhookRepo.createWebhook({ ...data, signingKeyId: data.signing_key_id });
    await audit('webhook.create', 'webhook', created.id, { url: created.url });
    return created;
  }, {
    detail: { summary: 'Create webhook', tags: ['Webhooks'] },
  })
  .get('/events', () => ({ events: SUPPORTED_WEBHOOK_EVENTS }), {
    detail: { summary: 'List supported webhook events', tags: ['Webhooks'] },
  })
  .get('/:webhookId', async ({ params }) => {
    const webhook = await webhookRepo.getWebhook(params.webhookId);
    if (!webhook) return new Response('Not found', { status: 404 });
    return webhook;
  }, {
    detail: { summary: 'Get webhook by ID', tags: ['Webhooks'] },
  })
  .get('/:webhookId/logs', async ({ params, query }) => {
    const items = await auditRepo.queryAuditLogs({
      resourceType: 'webhook',
      resourceId: params.webhookId,
      limit: query.limit ? Number(query.limit) : 50,
    });
    return { items, total: items.length };
  }, {
    detail: { summary: 'List webhook delivery and diagnostic logs', tags: ['Webhooks'] },
  })
  .put('/:webhookId', async ({ params, body }) => {
    const data = body as { url?: string; events?: string[]; enabled?: boolean; signing_key_id?: string };
    const updated = await webhookRepo.updateWebhook(params.webhookId, {
      url: data.url,
      events: data.events,
      enabled: data.enabled,
      signingKeyId: data.signing_key_id,
    });
    await audit('webhook.update', 'webhook', params.webhookId);
    return updated;
  }, {
    detail: { summary: 'Update webhook', tags: ['Webhooks'] },
  })
  .delete('/:webhookId', async ({ params }) => {
    await webhookRepo.deleteWebhook(params.webhookId);
    await audit('webhook.delete', 'webhook', params.webhookId);
  }, {
    detail: { summary: 'Delete webhook', tags: ['Webhooks'] },
  })
  .post('/:webhookId/rotate-secret', async ({ params }) => {
    const updated = await webhookRepo.rotateWebhookSecret(params.webhookId);
    await audit('webhook.rotate_secret', 'webhook', params.webhookId);
    return updated;
  }, {
    detail: { summary: 'Rotate webhook signing secret', tags: ['Webhooks'] },
  })
  .post('/:webhookId/test', async ({ params, body }) => {
    const webhook = await webhookRepo.getWebhookWithSecret(params.webhookId);
    if (!webhook) return new Response('Not found', { status: 404 });
    const data = body as { event?: string; payload?: Record<string, unknown> };
    return deliverWebhookOnce(params.webhookId, webhook.url, webhook.secret, buildEvent(data.event || 'webhook.test', data.payload || { test: true }));
  }, {
    detail: { summary: 'Send diagnostic webhook delivery', tags: ['Webhooks'] },
  })
  .post('/:webhookId/replay', async ({ params, body }) => {
    const webhook = await webhookRepo.getWebhookWithSecret(params.webhookId);
    if (!webhook) return new Response('Not found', { status: 404 });
    const data = body as { event: string; payload?: Record<string, unknown> };
    return deliverWebhookOnce(params.webhookId, webhook.url, webhook.secret, buildEvent(data.event, data.payload || {}));
  }, {
    detail: { summary: 'Replay webhook event payload', tags: ['Webhooks'] },
  });
