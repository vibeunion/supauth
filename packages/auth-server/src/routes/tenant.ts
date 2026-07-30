import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import { pagedResponse } from '../utils/api-contract.js';
import * as auditRepo from '../repositories/audit.js';

const adapter = getSupaCloudAdapter();

export const tenantRoutes = new Elysia({ prefix: '/v1/tenant' })
  .get('/members', async ({ query }) => {
    const members = await adapter.listTenantMembers({
      page: query.page,
      limit: query.limit,
      search: query.search,
    });
    return pagedResponse(members, { page: query.page, limit: query.limit });
  }, {
    detail: { summary: 'List project collaborators', tags: ['Project'] },
  })
  .patch('/members/:memberId', async ({ params, body }) => {
    const updated = await adapter.updateTenantMember(params.memberId, body as Record<string, unknown>);
    await auditTenantMutation('tenant.member.update', params.memberId);
    return updated;
  }, {
    detail: { summary: 'Update project collaborator role', tags: ['Project'] },
  })
  .delete('/members/:memberId', async ({ params }) => {
    const removed = await adapter.removeTenantMember(params.memberId);
    await auditTenantMutation('tenant.member.remove', params.memberId);
    return removed;
  }, {
    detail: { summary: 'Remove a project collaborator', tags: ['Project'] },
  })
  .get('/invitations', async ({ query }) => {
    const invitations = await adapter.listTenantInvitations({
      page: query.page,
      limit: query.limit,
      status: query.status,
    });
    return pagedResponse(invitations, { page: query.page, limit: query.limit });
  }, {
    detail: { summary: 'List project collaborator invitations', tags: ['Project'] },
  })
  .post('/invitations', async ({ body }) => {
    const invitation = await adapter.createTenantInvitation(body as Record<string, unknown>);
    const invitationId = String((invitation as Record<string, unknown>).id || '');
    await auditTenantMutation('tenant.invitation.create', invitationId);
    return invitation;
  }, {
    detail: { summary: 'Invite a project collaborator', tags: ['Project'] },
  });

async function auditTenantMutation(eventType: string, resourceId: string) {
  await auditRepo.logAudit({ eventType, resourceType: 'tenant', resourceId, actorType: 'admin' });
}
