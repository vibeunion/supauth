// Application management routes with OpenAPI annotations

import { Elysia, t } from 'elysia';
import { getSupaCloudAdapter, isSupaCloudApiError } from '../supacloud/adapter.js';
import * as bindingRepo from '../repositories/bindings.js';
import * as auditRepo from '../repositories/audit.js';
import * as webhookDelivery from '../repositories/webhook-delivery.js';
import * as appControlRepo from '../repositories/application-control.js';
import * as sieRepo from '../repositories/sign-in-experience.js';

const adapter = getSupaCloudAdapter();

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  try { await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details }); } catch {}
}

async function fireWebhook(eventType: string, data: Record<string, unknown>) {
  try { await webhookDelivery.dispatchEvent(webhookDelivery.buildEvent(eventType, data)); } catch {}
}

const LIST_KEYS = ['items', 'data', 'clients', 'oauth_clients', 'applications', 'secrets'] as const;

function listInfo(value: unknown): { items: unknown[]; total?: number } | null {
  if (Array.isArray(value)) return { items: value };
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  for (const key of LIST_KEYS) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return { items: candidate };
    if (candidate && typeof candidate === 'object' && Array.isArray((candidate as Record<string, unknown>).items)) {
      const nested = candidate as { items: unknown[]; total?: unknown };
      return {
        items: nested.items,
        total: typeof nested.total === 'number' ? nested.total : undefined,
      };
    }
  }

  return null;
}

function toListResponse(value: unknown) {
  const list = listInfo(value);
  if (list) {
    const total = value && typeof value === 'object' && typeof (value as { total?: unknown }).total === 'number'
      ? (value as { total: number }).total
      : list.total ?? list.items.length;
    return { items: list.items, total };
  }
  return { items: [], total: 0 };
}

function getSecretId(secret: unknown) {
  if (!secret || typeof secret !== 'object') return undefined;
  const record = secret as Record<string, unknown>;
  return String(record.secret_id || record.secretId || record.id || '');
}

function unsupportedClientSecretsResponse() {
  return new Response(JSON.stringify({
    error: 'not_supported',
    message: 'This SupaCloud cluster does not support per-client secret lifecycle APIs. Use Rotate Secret for the current OAuth client.',
  }), {
    status: 501,
    headers: { 'content-type': 'application/json' },
  });
}

export const applicationRoutes = new Elysia({ prefix: '/v1/applications' })
  .get('/', async () => {
    const res = await adapter.listOAuthClients();
    await audit('application.list', 'application', 'all');
    return toListResponse(res);
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
    return toListResponse(await adapter.listClientSecrets(params.appId));
  }, {
    detail: { summary: 'List application client secrets', tags: ['Applications', 'Secrets'] },
  })

  .post('/:appId/secrets', async ({ params, body }) => {
    const data = body as { name?: string; expires_at?: string };
    let secret: unknown;
    try {
      secret = await adapter.createClientSecret(params.appId, {
        name: data.name,
        expires_at: data.expires_at,
      });
    } catch (error) {
      if (isSupaCloudApiError(error, [404, 501])) return unsupportedClientSecretsResponse();
      throw error;
    }
    await audit('application.secret.create', 'application', params.appId, { secret_id: getSecretId(secret) });
    await fireWebhook('application.secret_created', { client_id: params.appId, secret_id: getSecretId(secret) });
    return secret;
  }, {
    detail: { summary: 'Create application client secret', tags: ['Applications', 'Secrets'] },
  })

  .post('/:appId/secrets/:secretId/disable', async ({ params }) => {
    let secret: unknown;
    try {
      secret = await adapter.disableClientSecret(params.appId, params.secretId);
    } catch (error) {
      if (isSupaCloudApiError(error, [404, 501])) return unsupportedClientSecretsResponse();
      throw error;
    }
    await audit('application.secret.disable', 'application', params.appId, { secret_id: params.secretId });
    return secret;
  }, {
    detail: { summary: 'Disable application client secret', tags: ['Applications', 'Secrets'] },
  })

  .delete('/:appId/secrets/:secretId', async ({ params }) => {
    let secret: unknown;
    try {
      secret = await adapter.deleteClientSecret(params.appId, params.secretId);
    } catch (error) {
      if (isSupaCloudApiError(error, [404, 501])) return unsupportedClientSecretsResponse();
      throw error;
    }
    await audit('application.secret.delete', 'application', params.appId, { secret_id: params.secretId });
    return secret;
  }, {
    detail: { summary: 'Delete application client secret', tags: ['Applications', 'Secrets'] },
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

  .get('/:appId/sign-in-experience', async ({ params }) => {
    const experience = await sieRepo.getApplicationSignInExperience(params.appId);
    return experience || {
      application_id: params.appId,
      enabled: false,
      branding: {
        logo_url: null,
        favicon_url: null,
        primary_color: null,
        page_title: null,
        background_url: null,
        button_label: null,
        custom_css: null,
      },
    };
  }, {
    detail: { summary: 'Get application sign-in experience overrides', tags: ['Applications', 'Sign-in Experience'] },
  })

  .put('/:appId/sign-in-experience', async ({ params, body }) => {
    const data = body as Parameters<typeof sieRepo.upsertApplicationSignInExperience>[1];
    const saved = await sieRepo.upsertApplicationSignInExperience(params.appId, data);
    await audit('application.sign_in_experience.update', 'application', params.appId, { enabled: saved.enabled });
    return saved;
  }, {
    detail: { summary: 'Update application sign-in experience overrides', tags: ['Applications', 'Sign-in Experience'] },
  })

  .delete('/:appId/sign-in-experience', async ({ params }) => {
    await sieRepo.deleteApplicationSignInExperience(params.appId);
    await audit('application.sign_in_experience.delete', 'application', params.appId);
    return new Response(null, { status: 204 });
  }, {
    detail: { summary: 'Delete application sign-in experience overrides', tags: ['Applications', 'Sign-in Experience'] },
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
