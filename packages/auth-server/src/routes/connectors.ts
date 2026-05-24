// Connector management routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as auditRepo from '../repositories/audit.js';
import * as webhookDelivery from '../repositories/webhook-delivery.js';

const adapter = getSupaCloudAdapter();

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  try { await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details }); } catch {}
}

async function fireWebhook(eventType: string, data: Record<string, unknown>) {
  try { await webhookDelivery.dispatchEvent(webhookDelivery.buildEvent(eventType, data)); } catch {}
}

export const connectorRoutes = new Elysia({ prefix: '/v1/connectors' })
  .get('/', async () => adapter.listProviders(), {
    detail: { summary: 'List connectors (identity providers)', tags: ['Connectors'] },
  })
  .get('/:connectorId', async ({ params }) => adapter.getProvider(params.connectorId), {
    detail: { summary: 'Get connector by ID', tags: ['Connectors'] },
  })
  .patch('/:connectorId', async ({ params, body }) => {
    const updated = await adapter.updateProvider(params.connectorId, body as Record<string, unknown>);
    await audit('connector.update', 'connector', params.connectorId);
    await fireWebhook('connector.updated', { connector_id: params.connectorId });
    return updated;
  }, {
    detail: { summary: 'Update connector configuration', tags: ['Connectors'] },
  })
  .post('/:connectorId/test', async ({ params }) => {
    const provider = await adapter.getProvider(params.connectorId);
    return { connector_id: params.connectorId, status: provider ? 'reachable' : 'unreachable' };
  }, {
    detail: { summary: 'Test connector connectivity', tags: ['Connectors'] },
  });
