// Webhook management routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import { SUPPORTED_WEBHOOK_EVENTS, WEBHOOK_EVENT_CATALOG } from '../repositories/webhook-delivery.js';
import * as auditRepo from '../repositories/audit.js';
import { ApiContractError, cursorResponse, pagedResponse } from '../utils/api-contract.js';
import { withoutSecrets } from '../utils/secrets.js';

const adapter = getSupaCloudAdapter();
const supportedWebhookEventSet = new Set<string>(SUPPORTED_WEBHOOK_EVENTS);

function validateWebhookUrl(rawUrl: unknown): void {
  if (typeof rawUrl !== 'string') throw invalidWebhookUrl();
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw invalidWebhookUrl();
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw invalidWebhookUrl();
}

function validateOptionalWebhookUrl(webhook: Record<string, unknown>): void {
  if (webhook.url !== undefined) validateWebhookUrl(webhook.url);
}

function webhookInput(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiContractError(400, 'invalid_request_body', 'Webhook request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

function invalidWebhookUrl() {
  return new ApiContractError(
    400,
    'invalid_webhook_url',
    'Webhook URL must be an absolute HTTPS URL without credentials',
  );
}

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details });
}

export const webhookRoutes = new Elysia({ prefix: '/v1/webhooks' })
  .get('/', async ({ query }) => {
    return withoutSecrets(pagedResponse(await adapter.listWebhooks(), { page: query.page, limit: query.limit }));
  }, {
    detail: { summary: 'List webhooks', tags: ['Webhooks'] },
  })
  .post('/', async ({ body }) => {
    const webhook = webhookInput(body);
    validateWebhookUrl(webhook.url);
    const validationError = unsupportedWebhookEventsResponse(webhook.events);
    if (validationError) return validationError;
    const created = await adapter.createWebhook(webhook);
    const record = created as Record<string, unknown>;
    await audit('webhook.create', 'webhook', String(record.id || ''), { url: record.url });
    return withoutSecrets(created);
  }, {
    detail: { summary: 'Create webhook', tags: ['Webhooks'] },
  })
  .get('/events', () => ({ events: SUPPORTED_WEBHOOK_EVENTS, catalog: WEBHOOK_EVENT_CATALOG }), {
    detail: { summary: 'List supported webhook events', tags: ['Webhooks'] },
  })
  .get('/:webhookId', async ({ params }) => {
    return withoutSecrets(await adapter.getWebhook(params.webhookId));
  }, {
    detail: { summary: 'Get webhook by ID', tags: ['Webhooks'] },
  })
  .get('/:webhookId/logs', async ({ params, query }) => {
    return withoutSecrets(cursorResponse(
      await adapter.listWebhookLogs(params.webhookId, { limit: query.limit || 50, cursor: query.cursor }),
      { limit: query.limit },
    ));
  }, {
    detail: { summary: 'List webhook delivery and diagnostic logs', tags: ['Webhooks'] },
  })
  .put('/:webhookId', async ({ params, body }) => {
    const webhook = webhookInput(body);
    validateOptionalWebhookUrl(webhook);
    const validationError = webhook.events === undefined ? null : unsupportedWebhookEventsResponse(webhook.events);
    if (validationError) return validationError;
    const updated = await adapter.updateWebhook(params.webhookId, webhook);
    await audit('webhook.update', 'webhook', params.webhookId);
    return withoutSecrets(updated);
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
    return withoutSecrets(updated);
  }, {
    detail: { summary: 'Rotate webhook signing secret', tags: ['Webhooks'] },
  })
  .post('/:webhookId/test', async ({ params, body }) => {
    rejectCustomWebhookTestPayload(body);
    return adapter.testWebhook(params.webhookId);
  }, {
    detail: {
      summary: 'Send diagnostic webhook delivery',
      description: 'SupaCloud generates the webhook.test payload; callers cannot supply event data.',
      tags: ['Webhooks'],
    },
  })
  .get('/:webhookId/deliveries', async ({ params, query }) => {
    const deliveries = await adapter.listWebhookDeliveries(params.webhookId, {
      limit: query.limit,
      cursor: query.cursor,
      status: query.status,
    });
    return withoutSecrets(cursorResponse(deliveries, { limit: query.limit }));
  }, {
    detail: { summary: 'List durable webhook deliveries', tags: ['Webhooks'] },
  })
  .get('/:webhookId/deliveries/:deliveryId', async ({ params }) => {
    return withoutSecrets(await adapter.getWebhookDelivery(params.webhookId, params.deliveryId));
  }, {
    detail: { summary: 'Get webhook delivery detail', tags: ['Webhooks'] },
  })
  .post('/:webhookId/deliveries/:deliveryId/replay', async ({ params }) => {
    const replay = await adapter.replayWebhookDelivery(params.webhookId, params.deliveryId);
    await audit('webhook.delivery.replay', 'webhook', params.webhookId, { delivery_id: params.deliveryId });
    return withoutSecrets(replay);
  }, {
    detail: { summary: 'Replay the exact durable webhook delivery', tags: ['Webhooks'] },
  });

function rejectCustomWebhookTestPayload(body: unknown): void {
  if (body === undefined || body === null) return;
  if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0) {
    throw new ApiContractError(400, 'invalid_webhook_test_payload', 'Webhook test payload is generated by SupaCloud');
  }
}

function unsupportedWebhookEventsResponse(events: unknown): Response | null {
  if (!Array.isArray(events)) return new Response('events must be an array', { status: 400 });
  const invalid = events
    .filter((event) => typeof event !== 'string' || (!supportedWebhookEventSet.has(event) && event !== '*'))
    .map(String);
  if (invalid.length === 0) return null;
  return new Response(`Invalid event types: ${invalid.join(', ')}. Supported: ${SUPPORTED_WEBHOOK_EVENTS.join(', ')}, *`, { status: 400 });
}
