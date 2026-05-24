// Organization management routes with OpenAPI annotations

import { Elysia } from 'elysia';
import * as orgRepo from '../repositories/organizations.js';
import * as roleRepo from '../repositories/roles.js';
import * as auditRepo from '../repositories/audit.js';
import * as webhookDelivery from '../repositories/webhook-delivery.js';
import { syncUserMetadata, syncOrgMetadata } from '../sync/index.js';

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  try { await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details }); } catch {}
}

async function fireWebhook(eventType: string, data: Record<string, unknown>) {
  try { await webhookDelivery.dispatchEvent(webhookDelivery.buildEvent(eventType, data)); } catch {}
}

export const organizationRoutes = new Elysia({ prefix: '/v1/organizations' })
  .get('/', async () => {
    const items = await orgRepo.listOrganizations();
    return { items, total: items.length };
  }, {
    detail: { summary: 'List organizations', tags: ['Organizations'] },
  })
  .post('/', async ({ body }) => {
    const created = await orgRepo.createOrganization(body as { name: string; description?: string });
    await audit('organization.create', 'organization', created.id, { name: created.name });
    await fireWebhook('organization.created', { org_id: created.id, name: created.name });
    return created;
  }, {
    detail: { summary: 'Create organization', tags: ['Organizations'] },
  })
  .get('/:orgId', async ({ params }) => {
    const org = await orgRepo.getOrganization(params.orgId);
    if (!org) return new Response('Not found', { status: 404 });
    return org;
  }, {
    detail: { summary: 'Get organization by ID', tags: ['Organizations'] },
  })
  .put('/:orgId', async ({ params, body }) => {
    const updated = await orgRepo.updateOrganization(params.orgId, body as { name?: string; description?: string });
    await audit('organization.update', 'organization', params.orgId);
    return updated;
  }, {
    detail: { summary: 'Update organization', tags: ['Organizations'] },
  })
  .delete('/:orgId', async ({ params }) => {
    await orgRepo.deleteOrganization(params.orgId);
    await audit('organization.delete', 'organization', params.orgId);
  }, {
    detail: { summary: 'Delete organization', tags: ['Organizations'] },
  })
  // ─── Members ───
  .post('/:orgId/members', async ({ params, body }) => {
    const data = body as { user_id: string; role?: string };
    const member = await orgRepo.addMember(params.orgId, data.user_id, data.role);
    await audit('organization.add_member', 'organization', params.orgId, { user_id: data.user_id });
    await fireWebhook('organization.member_added', { org_id: params.orgId, user_id: data.user_id });
    await syncUserMetadata(data.user_id, params.orgId);
    return member;
  }, {
    detail: { summary: 'Add member to organization', tags: ['Organizations', 'Members'] },
  })
  .delete('/:orgId/members/:userId', async ({ params }) => {
    await orgRepo.removeMember(params.orgId, params.userId);
    await audit('organization.remove_member', 'organization', params.orgId, { user_id: params.userId });
    await fireWebhook('organization.member_removed', { org_id: params.orgId, user_id: params.userId });
    await syncUserMetadata(params.userId);
  }, {
    detail: { summary: 'Remove member from organization', tags: ['Organizations', 'Members'] },
  })
  .patch('/:orgId/members/:userId', async ({ params, body }) => {
    const data = body as { role: string };
    const updated = await orgRepo.updateMemberRole(params.orgId, params.userId, data.role);
    await syncUserMetadata(params.userId, params.orgId);
    return updated;
  }, {
    detail: { summary: 'Update member role in organization', tags: ['Organizations', 'Members'] },
  })
  .get('/:orgId/roles', async ({ params }) => {
    const assignments = await roleRepo.getOrgRoleAssignments(params.orgId);
    return { items: assignments, total: assignments.length };
  }, {
    detail: { summary: 'Get role assignments for organization', tags: ['Organizations', 'RBAC'] },
  });
