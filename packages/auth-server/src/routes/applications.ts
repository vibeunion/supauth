// Application management routes with OpenAPI annotations

import { Elysia, t } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as bindingRepo from '../repositories/bindings.js';
import * as auditRepo from '../repositories/audit.js';
import * as webhookDelivery from '../repositories/webhook-delivery.js';

const adapter = getSupaCloudAdapter();

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  try { await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details }); } catch {}
}

async function fireWebhook(eventType: string, data: Record<string, unknown>) {
  try { await webhookDelivery.dispatchEvent(webhookDelivery.buildEvent(eventType, data)); } catch {}
}

export const applicationRoutes = new Elysia({ prefix: '/v1/applications' })
  .get('/', async () => {
    const res = await adapter.listOAuthClients();
    await audit('application.list', 'application', 'all');
    return res;
  }, {
    detail: { summary: 'List OAuth applications', tags: ['Applications'] },
  })

  .post('/', async ({ body }) => {
    const created = await adapter.createOAuthClient(body as Record<string, unknown>);
    const clientId = String((created as Record<string, unknown>).client_id);
    await audit('application.create', 'application', clientId, { name: (body as Record<string, unknown>).client_name });
    await fireWebhook('application.created', { client_id: clientId });
    return created;
  }, {
    detail: { summary: 'Create OAuth application', tags: ['Applications'] },
  })

  .get('/:appId', async ({ params }) => adapter.getOAuthClient(params.appId), {
    detail: { summary: 'Get application by ID', tags: ['Applications'] },
  })

  .put('/:appId', async ({ params, body }) => {
    const updated = await adapter.updateOAuthClient(params.appId, body as Record<string, unknown>);
    await audit('application.update', 'application', params.appId);
    await fireWebhook('application.updated', { client_id: params.appId });
    return updated;
  }, {
    detail: { summary: 'Update application', tags: ['Applications'] },
  })

  .delete('/:appId', async ({ params }) => {
    await adapter.deleteOAuthClient(params.appId);
    await audit('application.delete', 'application', params.appId);
    await fireWebhook('application.deleted', { client_id: params.appId });
  }, {
    detail: { summary: 'Delete application', tags: ['Applications'] },
  })

  .post('/:appId/rotate-secret', async ({ params }) => {
    const result = await adapter.regenerateClientSecret(params.appId);
    await audit('application.rotate_secret', 'application', params.appId);
    return result;
  }, {
    detail: { summary: 'Rotate client secret', tags: ['Applications'] },
  })

  // ─── Application-Resource/Scope bindings ───
  .get('/:appId/bindings', async ({ params }) => {
    const bindings = await bindingRepo.listApplicationBindings(params.appId);
    return { items: bindings, total: bindings.length };
  }, {
    detail: { summary: 'List application resource/scope bindings', tags: ['Applications', 'Bindings'] },
  })

  .post('/:appId/bindings', async ({ params, body }) => {
    const data = body as { resource_id: string; scope_id?: string };
    const binding = await bindingRepo.createBinding({
      applicationId: params.appId,
      resourceId: data.resource_id,
      scopeId: data.scope_id,
    });
    await audit('binding.create', 'binding', binding.id, { app_id: params.appId });
    return binding;
  }, {
    detail: { summary: 'Create application binding', tags: ['Applications', 'Bindings'] },
  })

  .delete('/:appId/bindings/:bindingId', async ({ params }) => {
    await bindingRepo.deleteBinding(params.bindingId);
    await audit('binding.delete', 'binding', params.bindingId);
  }, {
    detail: { summary: 'Delete application binding', tags: ['Applications', 'Bindings'] },
  })

  .get('/:appId/scopes', async ({ params }) => {
    const scopes = await bindingRepo.listApplicationScopes(params.appId);
    return { items: scopes, total: scopes.length };
  }, {
    detail: { summary: 'List application scopes', tags: ['Applications', 'Bindings'] },
  });
