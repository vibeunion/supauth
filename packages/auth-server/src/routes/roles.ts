// Role and Permission management routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as auditRepo from '../repositories/audit.js';
import * as webhookDelivery from '../repositories/webhook-delivery.js';

const adapter = getSupaCloudAdapter();

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  try { await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details }); } catch {}
}

async function fireWebhook(eventType: string, data: Record<string, unknown>) {
  try { await webhookDelivery.dispatchEvent(webhookDelivery.buildEvent(eventType, data)); } catch {}
}

function toListResponse(value: unknown) {
  if (Array.isArray(value)) return { items: value, total: value.length };
  if (value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)) {
    const items = (value as { items: unknown[]; total?: unknown }).items;
    return { items, total: typeof (value as { total?: unknown }).total === 'number' ? (value as { total: number }).total : items.length };
  }
  return { items: [], total: 0 };
}

export const roleRoutes = new Elysia({ prefix: '/v1/roles' })
  .get('/', async () => {
    return toListResponse(await adapter.listRoles());
  }, {
    detail: { summary: 'List roles', tags: ['RBAC'] },
  })
  .post('/', async ({ body }) => {
    const data = body as { name: string; description?: string };
    const created = await adapter.createRole(data);
    const record = created as Record<string, unknown>;
    await audit('role.create', 'role', String(record.id || ''), { name: record.name });
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
    await audit('role.update', 'role', params.roleId);
    return updated;
  }, {
    detail: { summary: 'Update role', tags: ['RBAC'] },
  })
  .delete('/:roleId', async ({ params }) => {
    await adapter.deleteRole(params.roleId);
    await audit('role.delete', 'role', params.roleId);
  }, {
    detail: { summary: 'Delete role', tags: ['RBAC'] },
  })

  // ─── Permissions ───
  .post('/:roleId/permissions', async ({ params, body }) => {
    const data = body as { name: string; description?: string; scope_id?: string };
    const perm = await adapter.createPermission(params.roleId, data as Record<string, unknown>);
    const record = perm as Record<string, unknown>;
    await audit('permission.create', 'permission', String(record.id || ''), { role_id: params.roleId });
    return perm;
  }, {
    detail: { summary: 'Create permission under role', tags: ['RBAC', 'Permissions'] },
  })
  .delete('/:roleId/permissions/:permissionId', async ({ params }) => {
    await adapter.deletePermission(params.roleId, params.permissionId);
    await audit('permission.delete', 'permission', params.permissionId);
  }, {
    detail: { summary: 'Delete permission', tags: ['RBAC', 'Permissions'] },
  })
  .get('/:roleId/permissions', async ({ params }) => {
    return toListResponse(await adapter.listRolePermissions(params.roleId));
  }, {
    detail: { summary: 'List permissions for role', tags: ['RBAC', 'Permissions'] },
  })

  // ─── Role Assignments ───
  .post('/:roleId/assign', async ({ params, body }) => {
    const data = body as { user_id?: string; organization_id?: string; application_id?: string };
    const assignment = await adapter.assignRole(params.roleId, data as Record<string, unknown>);
    const record = assignment as Record<string, unknown>;
    await audit('role.assign', 'role_assignment', String(record.id || ''), { role_id: params.roleId, user_id: data.user_id });
    await fireWebhook('role.assigned', { role_id: params.roleId, user_id: data.user_id });
    return assignment;
  }, {
    detail: { summary: 'Assign role to user', tags: ['RBAC', 'Assignments'] },
  })
  .delete('/:roleId/assign/:assignmentId', async ({ params }) => {
    await adapter.revokeRole(params.roleId, params.assignmentId);
    await audit('role.revoke', 'role_assignment', params.assignmentId);
    await fireWebhook('role.revoked', { role_id: params.roleId, assignment_id: params.assignmentId });
  }, {
    detail: { summary: 'Revoke role assignment', tags: ['RBAC', 'Assignments'] },
  });
