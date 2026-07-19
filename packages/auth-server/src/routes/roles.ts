// Role and Permission management routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as auditRepo from '../repositories/audit.js';
import { ApiContractError, pagedResponse } from '../utils/api-contract.js';

const adapter = getSupaCloudAdapter();

async function auditStrict(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details });
}

export const roleRoutes = new Elysia({ prefix: '/v1/roles' })
  .get('/', async () => {
    return pagedResponse(await adapter.listRoles());
  }, {
    detail: { summary: 'List roles', tags: ['RBAC'] },
  })
  .post('/', async ({ body }) => {
    const data = body as { name: string; description?: string };
    const created = await adapter.createRole(data);
    const record = created as Record<string, unknown>;
    await auditStrict('role.create', 'role', String(record.id || ''), { name: record.name });
    return created;
  }, {
    detail: { summary: 'Create role', tags: ['RBAC'] },
  })
  .get('/:roleId', async ({ params }) => {
    return adapter.getRole(params.roleId);
  }, {
    detail: { summary: 'Get role by ID', tags: ['RBAC'] },
  })
  .put('/:roleId', async ({ params, body }) => {
    const updated = await adapter.updateRole(params.roleId, body as Record<string, unknown>);
    await auditStrict('role.update', 'role', params.roleId);
    return updated;
  }, {
    detail: { summary: 'Update role', tags: ['RBAC'] },
  })
  .delete('/:roleId', async ({ params }) => {
    await adapter.deleteRole(params.roleId);
    await auditStrict('role.delete', 'role', params.roleId);
  }, {
    detail: { summary: 'Delete role', tags: ['RBAC'] },
  })

  // ─── Permissions ───
  .post('/:roleId/permissions', async ({ params, body }) => {
    const data = body as { name: string; description?: string; scope_id?: string };
    const perm = await adapter.createPermission(params.roleId, data as Record<string, unknown>);
    const record = perm as Record<string, unknown>;
    await auditStrict('permission.create', 'permission', String(record.id || ''), { role_id: params.roleId });
    return perm;
  }, {
    detail: { summary: 'Create permission under role', tags: ['RBAC', 'Permissions'] },
  })
  .delete('/:roleId/permissions/:permissionId', async ({ params }) => {
    await adapter.deletePermission(params.roleId, params.permissionId);
    await auditStrict('permission.delete', 'permission', params.permissionId);
  }, {
    detail: { summary: 'Delete permission', tags: ['RBAC', 'Permissions'] },
  })
  .get('/:roleId/permissions', async ({ params }) => {
    return pagedResponse(await adapter.listRolePermissions(params.roleId));
  }, {
    detail: { summary: 'List permissions for role', tags: ['RBAC', 'Permissions'] },
  })

  // ─── Role Assignments ───
  .get('/:roleId/assign', async ({ params, query }) => {
    return pagedResponse(await adapter.listRoleAssignments(params.roleId, {
      target_type: query.target_type,
      page: query.page,
      limit: query.limit,
    }), { page: query.page, limit: query.limit });
  }, {
    detail: { summary: 'List role assignments for role', tags: ['RBAC', 'Assignments'] },
  })
  .post('/:roleId/assign', async ({ params, body }) => {
    const data = body as { user_id?: string; organization_id?: string; application_id?: string };
    await validateAssignmentTarget(data);
    const assignment = await adapter.assignRole(params.roleId, data as Record<string, unknown>);
    const record = assignment as Record<string, unknown>;
    await auditStrict('role.assign', 'role', params.roleId, {
      assignment_id: record.id,
      user_id: data.user_id,
      application_id: data.application_id,
      organization_id: data.organization_id,
    });
    return assignment;
  }, {
    detail: { summary: 'Assign role to a user or machine-to-machine application', tags: ['RBAC', 'Assignments'] },
  })
  .delete('/:roleId/assign/:assignmentId', async ({ params }) => {
    await adapter.revokeRole(params.roleId, params.assignmentId);
    await auditStrict('role.revoke', 'role', params.roleId, { assignment_id: params.assignmentId });
  }, {
    detail: { summary: 'Revoke role assignment', tags: ['RBAC', 'Assignments'] },
  });

async function validateAssignmentTarget(input: {
  user_id?: string;
  organization_id?: string;
  application_id?: string;
}) {
  const supplied = [input.user_id, input.organization_id, input.application_id].filter(value => value !== undefined);
  if (supplied.some(value => !nonEmptyString(value))) throw invalidAssignmentTarget();
  if (!input.user_id && (!input.application_id || input.organization_id)) throw invalidAssignmentTarget();
  if (input.user_id) await adapter.getUser(input.user_id);
  if (input.organization_id) await adapter.getOrganization(input.organization_id);
  if (input.application_id) await adapter.getOAuthClient(input.application_id);
}

function invalidAssignmentTarget() {
  return new ApiContractError(
    400,
    'invalid_role_assignment_target',
    'Use user_id with optional organization_id/application_id scope, or application_id alone for an M2M target',
  );
}

function nonEmptyString(input: unknown): input is string {
  return typeof input === 'string' && input.trim().length > 0;
}
