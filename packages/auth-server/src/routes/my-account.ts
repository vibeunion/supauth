// User self-service account center routes. The runtime user/session source is
// still GoTrue via SupaCloud; SupaOAuth records account-center audit state.

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as accountRepo from '../repositories/account-control.js';
import * as consentRepo from '../repositories/consents.js';
import * as auditRepo from '../repositories/audit.js';

const adapter = getSupaCloudAdapter();

function currentUserId(headers: Record<string, string | undefined>) {
  return headers['x-supaoauth-user-id'] || headers['x-user-id'] || null;
}

async function audit(eventType: string, userId: string, details?: Record<string, unknown>) {
  try {
    await auditRepo.logAudit({ eventType, actorId: userId, actorType: 'user', resourceType: 'user', resourceId: userId, details });
  } catch {}
}

export const myAccountRoutes = new Elysia({ prefix: '/v1/my-account' })
  .derive(({ headers }) => {
    const userId = currentUserId(headers);
    return { currentUserId: userId };
  })
  .get('/profile', async ({ currentUserId }) => {
    if (!currentUserId) return new Response('Missing account user id', { status: 401 });
    return adapter.getUser(currentUserId);
  }, {
    detail: { summary: 'Get current account profile', tags: ['Account Center'] },
  })
  .patch('/profile', async ({ currentUserId, body }) => {
    if (!currentUserId) return new Response('Missing account user id', { status: 401 });
    const result = await adapter.updateUser(currentUserId, body as Record<string, unknown>);
    await audit('my_account.profile.updated', currentUserId);
    return result;
  }, {
    detail: { summary: 'Update current account profile', tags: ['Account Center'] },
  })
  .get('/sessions', async ({ currentUserId }) => {
    if (!currentUserId) return new Response('Missing account user id', { status: 401 });
    const items = await accountRepo.listAccountSessions(currentUserId);
    return { items, total: items.length };
  }, {
    detail: { summary: 'List current account sessions', tags: ['Account Center'] },
  })
  .post('/sessions/:sessionId/revoke', async ({ currentUserId, params }) => {
    if (!currentUserId) return new Response('Missing account user id', { status: 401 });
    try {
      await adapter.revokeUserSession(currentUserId, params.sessionId);
    } catch {}
    return accountRepo.revokeAccountSession(currentUserId, params.sessionId);
  }, {
    detail: { summary: 'Revoke current account session', tags: ['Account Center'] },
  })
  .delete('/identities/:identityId', async ({ currentUserId, params }) => {
    if (!currentUserId) return new Response('Missing account user id', { status: 401 });
    const result = await adapter.unlinkUserIdentity(currentUserId, params.identityId);
    await audit('my_account.identity.unlinked', currentUserId, { identity_id: params.identityId });
    return result;
  }, {
    detail: { summary: 'Unlink current account identity', tags: ['Account Center'] },
  })
  .post('/mfa/:factorId/reset', async ({ currentUserId, params }) => {
    if (!currentUserId) return new Response('Missing account user id', { status: 401 });
    const result = await adapter.resetUserMfa(currentUserId, params.factorId);
    await audit('my_account.mfa.reset', currentUserId, { factor_id: params.factorId });
    return result;
  }, {
    detail: { summary: 'Reset current account MFA factor', tags: ['Account Center'] },
  })
  .get('/grants', async ({ currentUserId }) => {
    if (!currentUserId) return new Response('Missing account user id', { status: 401 });
    const items = await consentRepo.listUserConsents(currentUserId);
    return { items, total: items.length };
  }, {
    detail: { summary: 'List current account OAuth grants', tags: ['Account Center'] },
  })
  .delete('/grants/:consentId', async ({ currentUserId, params }) => {
    if (!currentUserId) return new Response('Missing account user id', { status: 401 });
    const result = await consentRepo.revokeConsent(params.consentId);
    await audit('my_account.grant.revoked', currentUserId, { consent_id: params.consentId });
    return result;
  }, {
    detail: { summary: 'Revoke current account OAuth grant', tags: ['Account Center'] },
  });
