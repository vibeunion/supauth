// Connector management routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as auditRepo from '../repositories/audit.js';
import * as webhookDelivery from '../repositories/webhook-delivery.js';
import * as tenantConfigRepo from '../repositories/tenant-config.js';
import * as connectorRepo from '../repositories/connectors.js';

const adapter = getSupaCloudAdapter();

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  try { await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details }); } catch {}
}

async function fireWebhook(eventType: string, data: Record<string, unknown>) {
  try { await webhookDelivery.dispatchEvent(webhookDelivery.buildEvent(eventType, data)); } catch {}
}

export interface ProviderInfo {
  id: string;
  name?: string;
  type?: string;
  enabled?: boolean;
  [key: string]: unknown;
}

function providerId(provider: ProviderInfo) {
  return String(provider.id || '');
}

function providerName(provider: ProviderInfo, fallbackId: string) {
  return String(provider.name || provider.id || fallbackId);
}

function providerCategory(provider: ProviderInfo) {
  return String(provider.type || 'social');
}

export function mergeProvidersWithConnectorConfigs(
  providers: ProviderInfo[],
  connectorConfigs: Array<{ id: string; provider_id?: string; enabled?: boolean; name?: string; category?: string }>,
) {
  const configByProviderId = new Map(
    connectorConfigs.map(config => [String(config.provider_id || config.id), config]),
  );

  return providers.map(provider => {
    const id = providerId(provider);
    const config = configByProviderId.get(id);
    return {
      ...provider,
      id,
      name: config?.name || provider.name || id,
      type: config?.category || provider.type || 'social',
      provider_enabled: provider.enabled === true,
      enabled: config?.enabled === true,
    };
  });
}

export const connectorRoutes = new Elysia({ prefix: '/v1/connectors' })
  .get('/', async () => {
    const [providers, connectorConfigs] = await Promise.all([
      adapter.listProviders() as Promise<ProviderInfo[]>,
      connectorRepo.listConnectorConfigs(),
    ]);
    return mergeProvidersWithConnectorConfigs(Array.isArray(providers) ? providers : [], connectorConfigs);
  }, {
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
    const data = body as Record<string, unknown>;
    const created = await adapter.updateProvider(params.factoryId, data) as ProviderInfo;
    await connectorRepo.upsertConnectorConfig({
      providerId: providerId(created) || params.factoryId,
      name: providerName(created, params.factoryId),
      category: providerCategory(created),
      enabled: data.enabled === true,
      config: data,
    });
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
    const data = body as Record<string, unknown>;
    const updated = await adapter.updateProvider(params.connectorId, data) as ProviderInfo;
    if (data.enabled !== undefined) {
      await connectorRepo.upsertConnectorConfig({
        providerId: params.connectorId,
        name: providerName(updated, params.connectorId),
        category: providerCategory(updated),
        enabled: data.enabled === true,
        config: data,
      });
    }
    await audit('connector.update', 'connector', params.connectorId);
    await fireWebhook('connector.updated', { connector_id: params.connectorId });
    const config = await connectorRepo.getConnectorConfig(params.connectorId);
    return mergeProvidersWithConnectorConfigs([updated], config ? [config] : [])[0];
  }, {
    detail: { summary: 'Update connector configuration', tags: ['Connectors'] },
  })
  .post('/:connectorId/test', async ({ params }) => {
    const provider = await adapter.getProvider(params.connectorId);
    return { connector_id: params.connectorId, status: provider ? 'reachable' : 'unreachable' };
  }, {
    detail: { summary: 'Test connector connectivity', tags: ['Connectors'] },
  });
