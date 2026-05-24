// User management routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as roleRepo from '../repositories/roles.js';
import * as auditRepo from '../repositories/audit.js';
import * as webhookDelivery from '../repositories/webhook-delivery.js';

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
  .delete('/:userId', async ({ params }) => {
    await adapter.deleteUser(params.userId);
    await audit('user.delete', 'user', params.userId);
    await fireWebhook('user.deleted', { user_id: params.userId });
  }, {
    detail: { summary: 'Delete user', tags: ['Users'] },
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
