// Role and Permission management routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { managementContract, decodeEndpointBody, decodeEndpointResponse, decodeManagementQuery } from '../utils/management-contract.js';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as auditRepo from '../repositories/audit.js';
import { ApiContractError, pagedResponse, isRecord } from '../utils/api-contract.js';

const adapter = getSupaCloudAdapter();
const RBAC_NAME_MAX_LENGTH = 255;

interface RoleCreateInput {
  role: { name: string; description?: string | null };
  permissions?: string[];
}

async function auditStrict(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details });
}

export const roleRoutes = new Elysia({ prefix: '/v1/roles' })
  .get('/', async () => {
    return decodeEndpointResponse('listRoles', pagedResponse(await adapter.listRoles()));
  }, managementContract("GET", "/v1/roles", {
    detail: { summary: 'List roles', tags: ['RBAC'] },
  }))
  .post('/', async ({ body }) => {
    const input = roleCreateInput(decodeEndpointBody('createRole', body));
    const created = decodeEndpointResponse('createRole', await createRole(input));
    await auditStrict('role.create', 'role', created.id, { name: created.name });
    return created;
  }, managementContract("POST", "/v1/roles", {
    detail: { summary: 'Create role', tags: ['RBAC'] },
  }, ({ body }) => { roleCreateInput(body); }))
  .get('/:roleId', async ({ params }) => {
    return decodeEndpointResponse('getRole', await adapter.getRole(params.roleId));
  }, managementContract("GET", "/v1/roles/:roleId", {
    detail: { summary: 'Get role by ID', tags: ['RBAC'] },
  }))
  .put('/:roleId', async ({ params, body }) => {
    const updated = await adapter.updateRole(params.roleId, roleUpdateInput(decodeEndpointBody('updateRole', body)));
    await auditStrict('role.update', 'role', params.roleId);
    return decodeEndpointResponse('updateRole', updated);
  }, managementContract("PUT", "/v1/roles/:roleId", {
    detail: { summary: 'Update role', tags: ['RBAC'] },
  }, ({ body }) => { roleUpdateInput(body); }))
  .delete('/:roleId', async ({ params }) => {
    await adapter.deleteRole(params.roleId);
    await auditStrict('role.delete', 'role', params.roleId);
  }, managementContract("DELETE", "/v1/roles/:roleId", {
    detail: { summary: 'Delete role', tags: ['RBAC'] },
  }))

  // ─── Permissions ───
  .post('/:roleId/permissions', async ({ params, body }) => {
    const data = decodeEndpointBody('createRolePermission', body);
    const perm = decodeEndpointResponse('createRolePermission', await adapter.createPermission(params.roleId, data));
    await auditStrict('permission.create', 'permission', perm.id, { role_id: params.roleId });
    return perm;
  }, managementContract("POST", "/v1/roles/:roleId/permissions", {
    detail: { summary: 'Create permission under role', tags: ['RBAC', 'Permissions'] },
  }))
  .delete('/:roleId/permissions/:permissionId', async ({ params }) => {
    await adapter.deletePermission(params.roleId, params.permissionId);
    await auditStrict('permission.delete', 'permission', params.permissionId);
  }, managementContract("DELETE", "/v1/roles/:roleId/permissions/:permissionId", {
    detail: { summary: 'Delete permission', tags: ['RBAC', 'Permissions'] },
  }))
  .get('/:roleId/permissions', async ({ params }) => {
    return decodeEndpointResponse('listRolePermissions', pagedResponse(await adapter.listRolePermissions(params.roleId)));
  }, managementContract("GET", "/v1/roles/:roleId/permissions", {
    detail: { summary: 'List permissions for role', tags: ['RBAC', 'Permissions'] },
  }))

  // ─── Role Assignments ───
  .get('/:roleId/assign', async ({ params, query: rawQuery }) => {
    const query = decodeManagementQuery('listRoleAssignments', rawQuery);
    return decodeEndpointResponse('listRoleAssignments', pagedResponse(await adapter.listRoleAssignments(params.roleId, {
      target_type: query.target_type,
      page: query.page,
      limit: query.limit,
    }), { page: query.page, limit: query.limit }));
  }, managementContract("GET", "/v1/roles/:roleId/assign", {
    detail: { summary: 'List role assignments for role', tags: ['RBAC', 'Assignments'] },
  }))
  .post('/:roleId/assign', async ({ params, body }) => {
    const data = decodeEndpointBody('assignRole', body);
    await validateAssignmentTarget(data);
    const assignment = decodeEndpointResponse('assignRole', await adapter.assignRole(params.roleId, data));
    await auditStrict('role.assign', 'role', params.roleId, {
      assignment_id: assignment.id,
      user_id: data.user_id,
      application_id: data.application_id,
      organization_id: data.organization_id,
    });
    return assignment;
  }, managementContract("POST", "/v1/roles/:roleId/assign", {
    detail: { summary: 'Assign role to a user or machine-to-machine application', tags: ['RBAC', 'Assignments'] },
  }))
  .delete('/:roleId/assign/:assignmentId', async ({ params }) => {
    await adapter.revokeRole(params.roleId, params.assignmentId);
    await auditStrict('role.revoke', 'role', params.roleId, { assignment_id: params.assignmentId });
  }, managementContract("DELETE", "/v1/roles/:roleId/assign/:assignmentId", {
    detail: { summary: 'Revoke role assignment', tags: ['RBAC', 'Assignments'] },
  }));

function invalidRoleInput(field: string) {
  return new ApiContractError(
    400,
    'invalid_role_input',
    `Invalid role field: ${field}`,
    { field },
  );
}

function roleInputRecord(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) throw invalidRoleInput('body');
  return body;
}

function normalizedRbacName(candidate: unknown, field = 'name') {
  if (typeof candidate !== 'string') throw invalidRoleInput(field);
  const name = candidate.trim();
  if (!name || name.length > RBAC_NAME_MAX_LENGTH) throw invalidRoleInput(field);
  return name;
}

function optionalDescription(input: Record<string, unknown>): { description?: string | null } {
  if (!Object.hasOwn(input, 'description')) return {};
  if (input["description"] !== null && typeof input["description"] !== 'string') {
    throw invalidRoleInput('description');
  }
  return { description: input["description"] };
}

function normalizedPermissions(candidate: unknown) {
  if (!Array.isArray(candidate)) throw invalidRoleInput('permissions');
  const permissions = candidate.map((permission: unknown) => normalizedRbacName(permission, 'permissions'));
  const uniqueNames = new Set(permissions.map(permission => permission.toLowerCase()));
  if (uniqueNames.size !== permissions.length) throw invalidRoleInput('permissions');
  return permissions;
}

function roleCreateInput(body: unknown): RoleCreateInput {
  const input = roleInputRecord(body);
  if (!Object.hasOwn(input, 'name')) throw invalidRoleInput('name');
  return {
    role: { name: normalizedRbacName(input["name"]), ...optionalDescription(input) },
    ...(Object.hasOwn(input, 'permissions')
      ? { permissions: normalizedPermissions(input["permissions"]) }
      : {}),
  };
}

function roleUpdateInput(body: unknown) {
  const input = roleInputRecord(body);
  return {
    ...(Object.hasOwn(input, 'name') ? { name: normalizedRbacName(input["name"]) } : {}),
    ...optionalDescription(input),
  };
}

function createdRoleId(created: unknown) {
  if (!isRecord(created)) throw roleCreationOutcomeUnknown();
  const roleId = created["id"];
  if (typeof roleId !== 'string' || !roleId.trim()) throw roleCreationOutcomeUnknown();
  return roleId;
}

function authoritativePermissionNames(role: unknown) {
  if (!isRecord(role)) return null;
  const permissions = role["permissions"];
  if (!Array.isArray(permissions)) return null;
  const names = permissions.map((permission: unknown) => {
    if (!isRecord(permission)) return null;
    const name = permission["name"];
    return typeof name === 'string' ? name : null;
  });
  return names.every((name): name is string => name !== null) ? names : null;
}

function permissionsMatch(role: unknown, requested: string[]) {
  const committed = authoritativePermissionNames(role);
  if (!committed || committed.length !== requested.length) return false;
  const committedNames = committed.toSorted();
  const requestedNames = requested.toSorted();
  return committedNames.every((name, index) => name === requestedNames[index]);
}

function roleCreationOutcomeUnknown() {
  return new ApiContractError(
    503,
    'role_creation_outcome_unknown',
    'Role creation could not be reconciled safely',
  );
}

async function rollbackCreatedRole(roleId: string, failure: unknown): Promise<never> {
  try {
    await adapter.deleteRole(roleId);
  } catch {
    throw roleCreationOutcomeUnknown();
  }
  throw failure;
}

async function createRole(input: RoleCreateInput) {
  const created = await adapter.createRole(input.role);
  if (input.permissions === undefined) return created;
  const roleId = createdRoleId(created);
  try {
    for (const permission of input.permissions) {
      await adapter.createPermission(roleId, { name: permission });
    }
    const authoritative = await adapter.getRole(roleId);
    if (!permissionsMatch(authoritative, input.permissions)) {
      throw new ApiContractError(
        502,
        'role_permissions_readback_mismatch',
        'Role permissions authoritative readback did not match the requested permissions',
      );
    }
    return authoritative;
  } catch (failure) {
    return rollbackCreatedRole(roleId, failure);
  }
}

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
