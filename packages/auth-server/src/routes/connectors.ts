// Connector management routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as auditRepo from '../repositories/audit.js';
import * as webhookDelivery from '../repositories/webhook-delivery.js';
import * as tenantConfigRepo from '../repositories/tenant-config.js';

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
  .get('/factories', async ({ query }) => {
    const items = await tenantConfigRepo.listConnectorFactories(query.category as string | undefined);
    return { items, total: items.length };
  }, {
    detail: { summary: 'List connector factory catalog', tags: ['Connectors', 'Connector Factory'] },
  })
  .put('/factories/:factoryId', async ({ params, body }) => {
    const data = body as {
      name: string;
      protocol: string;
      category: string;
      config_schema?: Record<string, unknown>;
      enabled?: boolean;
    };
    return tenantConfigRepo.upsertConnectorFactory(params.factoryId, {
      name: data.name,
      protocol: data.protocol,
      category: data.category,
      configSchema: data.config_schema,
      enabled: data.enabled,
    });
  }, {
    detail: { summary: 'Create or update connector factory definition', tags: ['Connectors', 'Connector Factory'] },
  })
  .post('/from-factory/:factoryId', async ({ params, body }) => {
    const created = await adapter.updateProvider(params.factoryId, body as Record<string, unknown>);
    await audit('connector.factory.instantiate', 'connector_factory', params.factoryId);
    return created;
  }, {
    detail: { summary: 'Instantiate or update connector from factory', tags: ['Connectors', 'Connector Factory'] },
  })
  .get('/:connectorId', async ({ params }) => adapter.getProvider(params.connectorId), {
    detail: { summary: 'Get connector by ID', tags: ['Connectors'] },
  })
  .get('/:connectorId/authorization-uri', async ({ params, query }) => {
    const provider = await adapter.getProvider(params.connectorId) as Record<string, unknown> | null;
    if (!provider) return new Response('Not found', { status: 404 });
    const authorizationEndpoint = provider.authorization_endpoint || provider.authorizationEndpoint;
    if (!authorizationEndpoint) {
      return {
        connector_id: params.connectorId,
        status: 'unavailable',
        reason: 'authorization_endpoint_missing',
      };
    }
    const url = new URL(String(authorizationEndpoint));
    if (query.redirect_uri) url.searchParams.set('redirect_uri', String(query.redirect_uri));
    if (query.state) url.searchParams.set('state', String(query.state));
    if (query.scope) url.searchParams.set('scope', String(query.scope));
    return {
      connector_id: params.connectorId,
      authorization_uri: url.toString(),
    };
  }, {
    detail: { summary: 'Build connector authorization URI preflight', tags: ['Connectors', 'Connector Factory'] },
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
