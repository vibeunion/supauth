// Role and Permission management routes with OpenAPI annotations

import { Elysia } from 'elysia';
import * as roleRepo from '../repositories/roles.js';
import * as auditRepo from '../repositories/audit.js';
import * as webhookDelivery from '../repositories/webhook-delivery.js';
import { syncUserMetadata } from '../sync/index.js';

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  try { await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details }); } catch {}
}

async function fireWebhook(eventType: string, data: Record<string, unknown>) {
  try { await webhookDelivery.dispatchEvent(webhookDelivery.buildEvent(eventType, data)); } catch {}
}

export const roleRoutes = new Elysia({ prefix: '/v1/roles' })
  .get('/', async () => {
    const items = await roleRepo.listRoles();
    return { items, total: items.length };
  }, {
    detail: { summary: 'List roles', tags: ['RBAC'] },
  })
  .post('/', async ({ body }) => {
    const data = body as { name: string; description?: string };
    const created = await roleRepo.createRole(data);
    await audit('role.create', 'role', created.id, { name: created.name });
    return created;
  }, {
    detail: { summary: 'Create role', tags: ['RBAC'] },
  })
  .get('/:roleId', async ({ params }) => {
    const role = await roleRepo.getRole(params.roleId);
    if (!role) return new Response('Not found', { status: 404 });
    return role;
  }, {
    detail: { summary: 'Get role by ID', tags: ['RBAC'] },
  })
  .put('/:roleId', async ({ params, body }) => {
    const updated = await roleRepo.updateRole(params.roleId, body as { name?: string; description?: string });
    await audit('role.update', 'role', params.roleId);
    return updated;
  }, {
    detail: { summary: 'Update role', tags: ['RBAC'] },
  })
  .delete('/:roleId', async ({ params }) => {
    await roleRepo.deleteRole(params.roleId);
    await audit('role.delete', 'role', params.roleId);
  }, {
    detail: { summary: 'Delete role', tags: ['RBAC'] },
  })

  // ─── Permissions ───
  .post('/:roleId/permissions', async ({ params, body }) => {
    const data = body as { name: string; description?: string; scope_id?: string };
    const perm = await roleRepo.createPermission({
      name: data.name,
      description: data.description,
      roleId: params.roleId,
      scopeId: data.scope_id,
    });
    await audit('permission.create', 'permission', perm.id, { role_id: params.roleId });
    return perm;
  }, {
    detail: { summary: 'Create permission under role', tags: ['RBAC', 'Permissions'] },
  })
  .delete('/:roleId/permissions/:permissionId', async ({ params }) => {
    await roleRepo.deletePermission(params.permissionId);
    await audit('permission.delete', 'permission', params.permissionId);
  }, {
    detail: { summary: 'Delete permission', tags: ['RBAC', 'Permissions'] },
  })
  .get('/:roleId/permissions', async ({ params }) => {
    const permissions = await roleRepo.listRolePermissions(params.roleId);
    return { items: permissions, total: permissions.length };
  }, {
    detail: { summary: 'List permissions for role', tags: ['RBAC', 'Permissions'] },
  })

  // ─── Role Assignments ───
  .post('/:roleId/assign', async ({ params, body }) => {
    const data = body as { user_id: string; organization_id?: string; application_id?: string };
    const assignment = await roleRepo.assignRole({
      roleId: params.roleId,
      userId: data.user_id,
      organizationId: data.organization_id,
      applicationId: data.application_id,
    });
    await audit('role.assign', 'role_assignment', assignment.id, { role_id: params.roleId, user_id: data.user_id });
    await fireWebhook('role.assigned', { role_id: params.roleId, user_id: data.user_id });
    await syncUserMetadata(data.user_id, data.organization_id);
    return assignment;
  }, {
    detail: { summary: 'Assign role to user', tags: ['RBAC', 'Assignments'] },
  })
  .delete('/:roleId/assign/:assignmentId', async ({ params }) => {
    await roleRepo.revokeRole(params.assignmentId);
    await audit('role.revoke', 'role_assignment', params.assignmentId);
    await fireWebhook('role.revoked', { role_id: params.roleId, assignment_id: params.assignmentId });
  }, {
    detail: { summary: 'Revoke role assignment', tags: ['RBAC', 'Assignments'] },
  });
