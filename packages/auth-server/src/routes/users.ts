// User management routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as auditRepo from '../repositories/audit.js';
import * as webhookDelivery from '../repositories/webhook-delivery.js';
import {
  mergeAdminUserAppMetadata,
  sanitizeAdminUserCreatePayload,
  sanitizeAdminUserUpdatePayload,
  userUpdateFailureBody,
} from './user-update-policy.js';
import { capabilityUnavailable, cursorResponse, pagedResponse } from '../utils/api-contract.js';
import { withoutSecrets } from '../utils/secrets.js';

const adapter = getSupaCloudAdapter();

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details });
}

async function fireWebhook(eventType: string, data: Record<string, unknown>) {
  await webhookDelivery.dispatchEvent(webhookDelivery.buildEvent(eventType, data));
}

function gotrueGrantPage(upstream: unknown) {
  const page = pagedResponse<Record<string, unknown>>(upstream);
  return { ...page, items: page.items.map((grant) => ({ ...grant, source: 'gotrue' })) };
}

export const userRoutes = new Elysia({ prefix: '/v1/users' })
  .get('/', async ({ query }) => {
    const pagination = { page: query.page, limit: query.limit };
    const users = await adapter.listUsers({
      page: query.page,
      limit: query.limit,
      search: query.search,
      email: query.email,
    });
    return pagedResponse(users, pagination);
  }, {
    detail: { summary: 'List users', tags: ['Users'] },
  })
  .post('/', async ({ body, set }) => {
    const payload = sanitizeAdminUserCreatePayload(body);
    if (!payload.ok) {
      set.status = payload.status;
      return userUpdateFailureBody(payload);
    }
    const created = await adapter.createUser(payload.data);
    const userId = String((created as Record<string, unknown>).id || '');
    await audit('user.create', 'user', userId);
    await fireWebhook('user.created', { user_id: userId });
    return withoutSecrets(created);
  }, {
    detail: { summary: 'Create a GoTrue user through SupaCloud', tags: ['Users'] },
  })
  .get('/:userId', async ({ params }) => adapter.getUser(params.userId), {
    detail: { summary: 'Get user by ID', tags: ['Users'] },
  })
  .put('/:userId', async ({ params, body, set }) => {
    const payload = sanitizeAdminUserUpdatePayload(body);
    if (!payload.ok) {
      set.status = payload.status;
      return userUpdateFailureBody(payload);
    }

    const updateData = 'app_metadata' in payload.data
      ? mergeAdminUserAppMetadata(payload.data, await adapter.getUser(params.userId))
      : payload.data;
    const updated = await adapter.updateUser(params.userId, updateData);
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
  .post('/:userId/unsuspend', async ({ params }) => {
    const result = await adapter.unsuspendUser(params.userId);
    await audit('user.unsuspend', 'user', params.userId);
    await fireWebhook('user.unsuspended', { user_id: params.userId });
    return result;
  }, {
    detail: { summary: 'Restore (unsuspend) user through SupaCloud', tags: ['Users', 'Account Center'] },
  })
  .delete('/:userId', async ({ params }) => {
    await adapter.deleteUser(params.userId);
    await audit('user.delete', 'user', params.userId);
    await fireWebhook('user.deleted', { user_id: params.userId });
  }, {
    detail: { summary: 'Delete user', tags: ['Users'] },
  })
  .get('/:userId/sessions', async () => {
    throw capabilityUnavailable('gotrue_admin_user_sessions');
  }, {
    detail: { hide: true },
  })
  .post('/:userId/sessions', async () => {
    throw capabilityUnavailable('gotrue_admin_user_sessions');
  }, {
    detail: { hide: true },
  })
  .post('/:userId/sessions/:sessionId/revoke', async () => {
    throw capabilityUnavailable('gotrue_admin_user_sessions');
  }, {
    detail: { hide: true },
  })
  .delete('/:userId/identities/:identityId', async () => {
    throw capabilityUnavailable('gotrue_admin_identity_unlink');
  }, {
    detail: { hide: true },
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
    return adapter.resolveUserPermissions(params.userId, orgId);
  }, {
    detail: { summary: 'Resolve effective permissions for a user', tags: ['Users', 'RBAC'] },
  })
  .get('/:userId/roles', async ({ params }) => {
    return pagedResponse(await adapter.getUserRoleAssignments(params.userId));
  }, {
    detail: { summary: 'Get role assignments for a user', tags: ['Users', 'RBAC'] },
  })
  .get('/:userId/logs', async ({ params, query }) => {
    const logs = await adapter.queryAuditLogs({
      resource_type: 'user',
      resource_id: params.userId,
      limit: query.limit,
      cursor: query.cursor,
    });
    return cursorResponse(logs, { limit: query.limit });
  }, {
    detail: { summary: 'List audit logs for a user', tags: ['Users', 'Audit'] },
  })
  .get('/:userId/organizations', async ({ params }) => {
    return pagedResponse(await adapter.listUserOrganizations(params.userId));
  }, {
    detail: { summary: 'List business organizations for a user', tags: ['Users', 'Organizations'] },
  })
  .get('/:userId/grants', async ({ params, query }) => {
    const grants = await adapter.listUserOAuthGrants(params.userId, {
      include_revoked: query.include_revoked,
    });
    return gotrueGrantPage(grants);
  }, {
    detail: { summary: 'List authoritative GoTrue OAuth grants for a user', tags: ['Users', 'OAuth'] },
  })
  .delete('/:userId/grants/:clientId', async () => {
    throw capabilityUnavailable('gotrue_admin_oauth_grants');
  }, {
    detail: { hide: true },
  });
