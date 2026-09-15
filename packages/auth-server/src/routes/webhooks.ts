// Webhook management routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import { SUPPORTED_WEBHOOK_EVENTS, WEBHOOK_EVENT_CATALOG } from '../repositories/webhook-delivery.js';
import * as auditRepo from '../repositories/audit.js';
import { ApiContractError, cursorResponse, pagedResponse, isRecord } from '../utils/api-contract.js';
import { withoutSecrets } from '../utils/secrets.js';
import { operationContract, operationInput, operationOutput } from '../utils/operation-contract.js';

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
  if (webhook["url"] !== undefined) validateWebhookUrl(webhook["url"]);
}

function webhookInput(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) {
    throw new ApiContractError(400, 'invalid_request_body', 'Webhook request body must be a JSON object');
  }
  return body;
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
    return operationOutput('listWebhooks', withoutSecrets(pagedResponse(await adapter.listWebhooks(), { page: query["page"], limit: query["limit"] })));
  }, operationContract('listWebhooks', {
    detail: { summary: 'List webhooks', tags: ['Webhooks'] },
  }))
  .post('/', async ({ body }) => {
    const webhook = webhookInput(body);
    validateWebhookUrl(webhook["url"]);
    const validationError = unsupportedWebhookEventsResponse(webhook["events"]);
    if (validationError) return validationError;
    const input = operationInput('createWebhook', { body }).body;
    const created = await adapter.createWebhook(input);
    const record = operationOutput('createWebhook', withoutSecrets(created));
    await audit('webhook.create', 'webhook', record.id, { url: record.url });
    return record;
  }, operationContract('createWebhook', {
    detail: { summary: 'Create webhook', tags: ['Webhooks'] },
  }, ({ body }) => {
    const input = webhookInput(body);
    validateWebhookUrl(input["url"]);
    return unsupportedWebhookEventsResponse(input["events"]) ?? undefined;
  }))
  .get('/events', () => ({ events: SUPPORTED_WEBHOOK_EVENTS, catalog: WEBHOOK_EVENT_CATALOG }), operationContract('listWebhookEvents', {
    detail: { summary: 'List supported webhook events', tags: ['Webhooks'] },
  }))
  .get('/:webhookId', async ({ params }) => {
    return operationOutput('getWebhook', withoutSecrets(await adapter.getWebhook(params.webhookId)));
  }, operationContract('getWebhook', {
    detail: { summary: 'Get webhook by ID', tags: ['Webhooks'] },
  }))
  .get('/:webhookId/logs', async ({ params, query }) => {
    return operationOutput('listWebhookLogs', withoutSecrets(cursorResponse(
      await adapter.listWebhookLogs(params.webhookId, { limit: query["limit"] || 50, cursor: query["cursor"] }),
      { limit: query["limit"] },
    )));
  }, operationContract('listWebhookLogs', {
    detail: { summary: 'List webhook delivery and diagnostic logs', tags: ['Webhooks'] },
  }))
  .put('/:webhookId', async ({ params, body }) => {
    const webhook = webhookInput(body);
    validateOptionalWebhookUrl(webhook);
    const validationError = webhook["events"] === undefined ? null : unsupportedWebhookEventsResponse(webhook["events"]);
    if (validationError) return validationError;
    const input = operationInput('updateWebhook', { params, body }).body;
    const updated = await adapter.updateWebhook(params.webhookId, input);
    await audit('webhook.update', 'webhook', params.webhookId);
    return operationOutput('updateWebhook', withoutSecrets(updated));
  }, operationContract('updateWebhook', {
    detail: { summary: 'Update webhook', tags: ['Webhooks'] },
  }, ({ body }) => {
    const input = webhookInput(body);
    validateOptionalWebhookUrl(input);
    return input["events"] === undefined ? undefined : unsupportedWebhookEventsResponse(input["events"]) ?? undefined;
  }))
  .delete('/:webhookId', async ({ params }) => {
    await adapter.deleteWebhook(params.webhookId);
    await audit('webhook.delete', 'webhook', params.webhookId);
  }, operationContract('deleteWebhook', {
    detail: { summary: 'Delete webhook', tags: ['Webhooks'] },
  }))
  .post('/:webhookId/rotate-secret', async ({ params }) => {
    const updated = await adapter.rotateWebhookSecret(params.webhookId);
    await audit('webhook.rotate_secret', 'webhook', params.webhookId);
    return operationOutput('rotateWebhookSecret', withoutSecrets(updated));
  }, operationContract('rotateWebhookSecret', {
    detail: { summary: 'Rotate webhook signing secret', tags: ['Webhooks'] },
  }))
  .post('/:webhookId/test', async ({ params, body, set }) => {
    rejectCustomWebhookTestPayload(body);
    const queuedDelivery = await adapter.testWebhook(params.webhookId);
    set.status = 202;
    return operationOutput('testWebhook', queuedDelivery);
  }, operationContract('testWebhook', {
    detail: {
      summary: 'Send diagnostic webhook delivery',
      description: 'SupaCloud generates the webhook.test payload; callers cannot supply event data.',
      tags: ['Webhooks'],
    },
  }, ({ body }) => rejectCustomWebhookTestPayload(body)))
  .get('/:webhookId/deliveries', async ({ params, query }) => {
    const deliveries = await adapter.listWebhookDeliveries(params.webhookId, {
      limit: query["limit"],
      cursor: query["cursor"],
      status: query["status"],
    });
    return operationOutput('listWebhookDeliveries', withoutSecrets(cursorResponse(deliveries, { limit: query["limit"] })));
  }, operationContract('listWebhookDeliveries', {
    detail: { summary: 'List durable webhook deliveries', tags: ['Webhooks'] },
  }))
  .get('/:webhookId/deliveries/:deliveryId', async ({ params }) => {
    return operationOutput('getWebhookDelivery', withoutSecrets(await adapter.getWebhookDelivery(params.webhookId, params.deliveryId)));
  }, operationContract('getWebhookDelivery', {
    detail: { summary: 'Get webhook delivery detail', tags: ['Webhooks'] },
  }))
  .post('/:webhookId/deliveries/:deliveryId/replay', async ({ params, set }) => {
    const replay = await adapter.replayWebhookDelivery(params.webhookId, params.deliveryId);
    await audit('webhook.delivery.replay', 'webhook', params.webhookId, { delivery_id: params.deliveryId });
    set.status = 202;
    return operationOutput('replayWebhookDelivery', withoutSecrets(replay));
  }, operationContract('replayWebhookDelivery', {
    detail: { summary: 'Replay the exact durable webhook delivery', tags: ['Webhooks'] },
  }));

function rejectCustomWebhookTestPayload(body: unknown): void {
  if (body === undefined || body === null) return;
  if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0) {
    throw new ApiContractError(400, 'invalid_webhook_test_payload', 'Webhook test payload is generated by SupaCloud');
  }
}

function unsupportedWebhookEventsResponse(events: unknown): Response | null {
  if (!Array.isArray(events)) return new Response('events must be an array', { status: 400 });
  const invalid = events
    .filter((event: unknown) => typeof event !== 'string' || (!supportedWebhookEventSet.has(event) && event !== '*'))
    .map(String);
  if (invalid.length === 0) return null;
  return new Response(`Invalid event types: ${invalid.join(', ')}. Supported: ${SUPPORTED_WEBHOOK_EVENTS.join(', ')}, *`, { status: 400 });
}
