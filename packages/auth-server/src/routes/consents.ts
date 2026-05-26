// Consent management routes (P0-17) with OpenAPI annotations

import { Elysia } from 'elysia';
import * as consentRepo from '../repositories/consents.js';
import * as auditRepo from '../repositories/audit.js';
import * as webhookDelivery from '../repositories/webhook-delivery.js';

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  try { await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details }); } catch {}
}

async function fireWebhook(eventType: string, data: Record<string, unknown>) {
  try { await webhookDelivery.dispatchEvent(webhookDelivery.buildEvent(eventType, data)); } catch {}
}

export const consentRoutes = new Elysia({ prefix: '/v1/consents' })
  // ─── User consent operations ───
  .get('/', async ({ query }) => {
    const userId = query.user_id as string;
    if (!userId) return new Response('user_id is required', { status: 400 });
    const items = await consentRepo.listUserConsents(userId);
    return { items, total: items.length };
  }, {
    detail: { summary: 'List active consents for a user', tags: ['Consents'] },
  })

  .post('/', async ({ body }) => {
    const data = body as { user_id: string; application_id: string; scope_id?: string; organization_id?: string };
    const consent = await consentRepo.grantConsent({
      userId: data.user_id,
      applicationId: data.application_id,
      scopeId: data.scope_id,
      organizationId: data.organization_id,
    });
    await audit('consent.grant', 'consent', consent.id, { user_id: data.user_id, app_id: data.application_id });
    await fireWebhook('consent.granted', { consent_id: consent.id, user_id: data.user_id, app_id: data.application_id });
    return consent;
  }, {
    detail: { summary: 'Record user consent', tags: ['Consents'] },
  })

  .get('/check', async ({ query }) => {
    const userId = query.user_id as string;
    const applicationId = query.application_id as string;
    const scopeId = query.scope_id as string | undefined;
    const orgId = query.organization_id as string | undefined;
    if (!userId || !applicationId) return new Response('user_id and application_id are required', { status: 400 });
    const hasConsent = await consentRepo.hasConsent({ userId, applicationId, scopeId, organizationId: orgId });
    return { has_consent: hasConsent };
  }, {
    detail: { summary: 'Check if user has active consent', tags: ['Consents'] },
  })

  .post('/decision', async ({ body }) => {
    const data = body as {
      user_id: string;
      application_id: string;
      scope_ids?: string[];
      organization_id?: string;
    };
    if (!data.user_id || !data.application_id) {
      return new Response('user_id and application_id are required', { status: 400 });
    }

    const scopeIds = data.scope_ids?.length ? data.scope_ids : [undefined];
    const missingScopes: string[] = [];
    for (const scopeId of scopeIds) {
      const granted = await consentRepo.hasConsent({
        userId: data.user_id,
        applicationId: data.application_id,
        scopeId,
        organizationId: data.organization_id,
      });
      if (!granted && scopeId) missingScopes.push(scopeId);
      if (!granted && !scopeId) missingScopes.push('*');
    }

    return {
      requires_consent: missingScopes.length > 0,
      missing_scope_ids: missingScopes,
      user_id: data.user_id,
      application_id: data.application_id,
      organization_id: data.organization_id || null,
    };
  }, {
    detail: { summary: 'Evaluate whether an authorization request requires consent', tags: ['Consents'] },
  })

  .get('/deny', ({ query }) => {
    const redirectUri = query.redirect_uri as string;
    const state = query.state as string | undefined;
    if (!redirectUri) return new Response('redirect_uri is required', { status: 400 });
    const url = new URL(redirectUri);
    url.searchParams.set('error', 'access_denied');
    url.searchParams.set('error_description', 'The resource owner denied the request');
    if (state) url.searchParams.set('state', state);
    return Response.redirect(url.toString(), 302);
  }, {
    detail: { summary: 'Build standard OAuth access_denied redirect', tags: ['Consents'] },
  })

  .delete('/:consentId', async ({ params }) => {
    const consent = await consentRepo.revokeConsent(params.consentId);
    await audit('consent.revoke', 'consent', params.consentId);
    await fireWebhook('consent.revoked', { consent_id: params.consentId });
    return consent;
  }, {
    detail: { summary: 'Revoke a specific consent', tags: ['Consents'] },
  })

  .delete('/', async ({ query }) => {
    const userId = query.user_id as string;
    const applicationId = query.application_id as string;
    if (!userId || !applicationId) return new Response('user_id and application_id are required', { status: 400 });
    const count = await consentRepo.revokeAllConsents(userId, applicationId);
    await audit('consent.revoke_all', 'consent', `${userId}:${applicationId}`, { count });
    return { revoked_count: count };
  }, {
    detail: { summary: 'Revoke all consents for user+application', tags: ['Consents'] },
  })

  // ─── Admin: list consents for a specific application ───
  .get('/application/:applicationId', async ({ params }) => {
    const items = await consentRepo.listApplicationConsents(params.applicationId);
    return { items, total: items.length };
  }, {
    detail: { summary: 'List consents for an application', tags: ['Consents'] },
  })

  // ─── Admin: list all consents for a user (including revoked) ───
  .get('/user/:userId/all', async ({ params }) => {
    const items = await consentRepo.listAllUserConsents(params.userId);
    return { items, total: items.length };
  }, {
    detail: { summary: 'List all consents for a user (including revoked)', tags: ['Consents'] },
  });
