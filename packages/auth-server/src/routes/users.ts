// User management routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { getSupaCloudAdapter, isSupaCloudApiError } from '../supacloud/adapter.js';
import * as auditRepo from '../repositories/audit.js';
import * as webhookDelivery from '../repositories/webhook-delivery.js';
import {
  mergeAdminUserAppMetadata,
  sanitizeAdminUserCreatePayload,
  sanitizeAdminUserUpdatePayload,
  userUpdateFailureBody,
} from './user-update-policy.js';
import {
  ApiContractError,
  capabilityUnavailable,
  cursorResponse,
  pagedResponse,
} from '../utils/api-contract.js';
import {
  passwordPolicyFromAuthConfig,
  passwordPolicyViolation,
} from '../utils/password-policy.js';
import { withoutSecrets } from '../utils/secrets.js';

const adapter = getSupaCloudAdapter();
const DEFAULT_USER_PAGE = 1;
const DEFAULT_USER_LIMIT = 50;
const MAX_USER_LIMIT = 100;

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

function parseUserPaginationValue(
  input: unknown,
  field: 'page' | 'limit',
  fallback: number,
  maximum: number,
): number {
  if (input === undefined) return fallback;
  const raw = typeof input === 'number' ? String(input) : input;
  const parsed = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new ApiContractError(
      400,
      'invalid_pagination',
      'Pagination parameters are outside the supported range.',
      { field, minimum: 1, maximum },
    );
  }
  return parsed;
}

function parseUserPagination(query: Record<string, unknown>) {
  return {
    page: parseUserPaginationValue(query.page, 'page', DEFAULT_USER_PAGE, Number.MAX_SAFE_INTEGER),
    limit: parseUserPaginationValue(query.limit, 'limit', DEFAULT_USER_LIMIT, MAX_USER_LIMIT),
  };
}

async function validateAdminCreatePassword(password: string): Promise<void> {
  let policy;
  try {
    policy = passwordPolicyFromAuthConfig(await adapter.getAuthConfig());
  } catch {
    throw new ApiContractError(
      503,
      'password_policy_unavailable',
      'Password policy is temporarily unavailable.',
    );
  }

  const violation = passwordPolicyViolation(password, policy);
  if (violation) {
    throw new ApiContractError(400, violation, 'Password does not satisfy the configured policy.');
  }
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);
}

function isMissingUserDeleteError(error: unknown): boolean {
  if (!isSupaCloudApiError(error, [400])) return false;
  let body: unknown;
  try {
    body = JSON.parse(error.body);
  } catch (parseError) {
    if (parseError instanceof SyntaxError) return false;
    throw parseError;
  }
  if (!isRecord(body)) return false;
  const nestedError = isRecord(body.error) ? body.error : {};
  return body.code === 'user_not_found'
    || body.error_code === 'user_not_found'
    || nestedError.code === 'user_not_found';
}

export const userRoutes = new Elysia({ prefix: '/v1/users' })
  .get('/', async ({ query }) => {
    const pagination = parseUserPagination(query);
    const users = await adapter.listUsers({
      page: pagination.page,
      limit: pagination.limit,
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
    if (typeof payload.data.password === 'string') {
      await validateAdminCreatePassword(payload.data.password);
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
    try {
      await adapter.deleteUser(params.userId);
    } catch (error) {
      if (isMissingUserDeleteError(error)) {
        throw new ApiContractError(404, 'not_found', 'User was not found.');
      }
      throw error;
    }
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
    const applicationId = query.application_id as string | undefined;
    return adapter.resolveUserPermissions(params.userId, orgId, applicationId);
  }, {
    detail: { summary: 'Resolve effective permissions for a user', tags: ['Users', 'RBAC'] },
  })
  .get('/:userId/roles', async ({ params, query }) => {
    const applicationId = query.application_id as string | undefined;
    return pagedResponse(await adapter.getUserRoleAssignments(params.userId, applicationId));
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
