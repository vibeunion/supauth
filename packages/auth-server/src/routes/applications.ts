// Application management routes with OpenAPI annotations

import { Elysia, t } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as bindingRepo from '../repositories/bindings.js';
import * as auditRepo from '../repositories/audit.js';
import * as webhookDelivery from '../repositories/webhook-delivery.js';
import * as appControlRepo from '../repositories/application-control.js';

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

  .get('/:appId/secrets', async ({ params }) => {
    const items = await appControlRepo.listApplicationSecrets(params.appId);
    return { items, total: items.length };
  }, {
    detail: { summary: 'List application client secrets', tags: ['Applications', 'Secrets'] },
  })

  .post('/:appId/secrets', async ({ params, body }) => {
    const data = body as { name?: string; expires_at?: string };
    const secret = await appControlRepo.createApplicationSecret(params.appId, {
      name: data.name,
      expiresAt: data.expires_at ? new Date(data.expires_at) : null,
    });
    await fireWebhook('application.secret_created', { client_id: params.appId, secret_id: secret.secretId });
    return secret;
  }, {
    detail: { summary: 'Create application client secret', tags: ['Applications', 'Secrets'] },
  })

  .post('/:appId/secrets/:secretId/disable', async ({ params }) => {
    const secret = await appControlRepo.disableApplicationSecret(params.appId, params.secretId);
    if (!secret) return new Response('Not found', { status: 404 });
    return secret;
  }, {
    detail: { summary: 'Disable application client secret', tags: ['Applications', 'Secrets'] },
  })

  .delete('/:appId/secrets/:secretId', async ({ params }) => {
    const secret = await appControlRepo.deleteApplicationSecret(params.appId, params.secretId);
    if (!secret) return new Response('Not found', { status: 404 });
    return secret;
  }, {
    detail: { summary: 'Delete application client secret metadata', tags: ['Applications', 'Secrets'] },
  })

  .get('/:appId/consent', async ({ params }) => {
    const settings = await appControlRepo.getApplicationConsentSettings(params.appId);
    return settings || {
      applicationId: params.appId,
      userScopes: [],
      organizationScopes: [],
      allowedOrganizationIds: [],
      requireExplicitConsent: true,
      customData: {},
    };
  }, {
    detail: { summary: 'Get application consent configuration', tags: ['Applications', 'Consent'] },
  })

  .put('/:appId/consent', async ({ params, body }) => {
    const data = body as {
      user_scopes?: string[];
      organization_scopes?: string[];
      allowed_organization_ids?: string[];
      require_explicit_consent?: boolean;
      custom_data?: Record<string, unknown>;
    };
    return appControlRepo.upsertApplicationConsentSettings(params.appId, {
      userScopes: data.user_scopes,
      organizationScopes: data.organization_scopes,
      allowedOrganizationIds: data.allowed_organization_ids,
      requireExplicitConsent: data.require_explicit_consent,
      customData: data.custom_data,
    });
  }, {
    detail: { summary: 'Update application consent configuration', tags: ['Applications', 'Consent'] },
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
