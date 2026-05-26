// User management routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as roleRepo from '../repositories/roles.js';
import * as auditRepo from '../repositories/audit.js';
import * as webhookDelivery from '../repositories/webhook-delivery.js';
import * as accountRepo from '../repositories/account-control.js';

const adapter = getSupaCloudAdapter();

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  try { await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details }); } catch {}
}

async function fireWebhook(eventType: string, data: Record<string, unknown>) {
  try { await webhookDelivery.dispatchEvent(webhookDelivery.buildEvent(eventType, data)); } catch {}
}

export const userRoutes = new Elysia({ prefix: '/v1/users' })
  .get('/', async () => adapter.listUsers(), {
    detail: { summary: 'List users', tags: ['Users'] },
  })
  .get('/:userId', async ({ params }) => adapter.getUser(params.userId), {
    detail: { summary: 'Get user by ID', tags: ['Users'] },
  })
  .put('/:userId', async ({ params, body }) => {
    const updated = await adapter.updateUser(params.userId, body as Record<string, unknown>);
    await audit('user.update', 'user', params.userId);
    await fireWebhook('user.updated', { user_id: params.userId });
    return updated;
  }, {
    detail: { summary: 'Update user profile or metadata through SupaCloud', tags: ['Users', 'Account Center'] },
  })
  .post('/:userId/suspend', async ({ params, body }) => {
    const result = await adapter.suspendUser(params.userId, body as Record<string, unknown>);
    await audit('user.suspend', 'user', params.userId);
    await fireWebhook('user.suspended', { user_id: params.userId });
    return result;
  }, {
    detail: { summary: 'Suspend user through SupaCloud', tags: ['Users', 'Account Center'] },
  })
  .delete('/:userId', async ({ params }) => {
    await adapter.deleteUser(params.userId);
    await audit('user.delete', 'user', params.userId);
    await fireWebhook('user.deleted', { user_id: params.userId });
  }, {
    detail: { summary: 'Delete user', tags: ['Users'] },
  })
  .get('/:userId/sessions', async ({ params }) => {
    const items = await accountRepo.listAccountSessions(params.userId);
    return { items, total: items.length };
  }, {
    detail: { summary: 'List tracked account-center sessions for user', tags: ['Users', 'Account Center'] },
  })
  .post('/:userId/sessions', async ({ params, body }) => {
    const data = body as { session_id: string; metadata?: Record<string, unknown> };
    return accountRepo.recordAccountSession(params.userId, data.session_id, data.metadata);
  }, {
    detail: { summary: 'Record account-center session metadata', tags: ['Users', 'Account Center'] },
  })
  .post('/:userId/sessions/:sessionId/revoke', async ({ params }) => {
    try {
      await adapter.revokeUserSession(params.userId, params.sessionId);
    } catch {
      // Keep local audit trail even when the SupaCloud runtime does not expose session revocation.
    }
    const session = await accountRepo.revokeAccountSession(params.userId, params.sessionId);
    return session || { userId: params.userId, sessionId: params.sessionId, status: 'revoked' };
  }, {
    detail: { summary: 'Revoke user session', tags: ['Users', 'Account Center'] },
  })
  .delete('/:userId/identities/:identityId', async ({ params }) => {
    const result = await adapter.unlinkUserIdentity(params.userId, params.identityId);
    await audit('user.identity.unlink', 'user', params.userId, { identity_id: params.identityId });
    return result;
  }, {
    detail: { summary: 'Unlink user social or SSO identity', tags: ['Users', 'Account Center'] },
  })
  .post('/:userId/mfa/:factorId/reset', async ({ params }) => {
    const result = await adapter.resetUserMfa(params.userId, params.factorId);
    await audit('user.mfa.reset', 'user', params.userId, { factor_id: params.factorId });
    return result;
  }, {
    detail: { summary: 'Reset user MFA factor', tags: ['Users', 'Account Center'] },
  })
  .get('/:userId/permissions', async ({ params, query }) => {
    const orgId = query.org_id as string | undefined;
    return roleRepo.resolveUserPermissions(params.userId, orgId);
  }, {
    detail: { summary: 'Resolve effective permissions for a user', tags: ['Users', 'RBAC'] },
  })
  .get('/:userId/roles', async ({ params }) => {
    const assignments = await roleRepo.getUserRoleAssignments(params.userId);
    return { items: assignments, total: assignments.length };
  }, {
    detail: { summary: 'Get role assignments for a user', tags: ['Users', 'RBAC'] },
  });
