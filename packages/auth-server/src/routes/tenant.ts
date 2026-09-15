import { Elysia } from 'elysia';
import { managementContract, decodeEndpointBody, decodeEndpointResponse, decodeManagementQuery } from '../utils/management-contract.js';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import { pagedResponse } from '../utils/api-contract.js';
import * as auditRepo from '../repositories/audit.js';
import { decodeSchema } from '../../../shared/src/schema.js';
import { TenantMemberRoleSchema, TenantInvitationRoleSchema, TenantMemberStatusSchema } from '../../../shared/src/sdk-models.js';

const adapter = getSupaCloudAdapter();

export const tenantRoutes = new Elysia({ prefix: '/v1/tenant' })
  .get('/members', async ({ query: rawQuery }) => {
    const query = decodeManagementQuery('listTenantMembers', rawQuery);
    const members = await adapter.listTenantMembers({
      page: query.page,
      limit: query.limit,
      search: query.search,
    });
    return decodeEndpointResponse('listTenantMembers', pagedResponse(members, { page: query.page, limit: query.limit }));
  }, managementContract("GET", "/v1/tenant/members", {
    detail: { summary: 'List project collaborators', tags: ['Project'] },
  }))
  .patch('/members/:memberId', async ({ params, body }) => {
    const input = decodeEndpointBody('updateTenantMember', body);
    const status = input.status?.trim().toLowerCase();
    const updated = await adapter.updateTenantMember(params.memberId, {
      ...(input.role === undefined ? {} : { role: decodeSchema(TenantMemberRoleSchema, input.role.trim().toLowerCase()) }),
      ...(!status ? {} : { status: decodeSchema(TenantMemberStatusSchema, status) }),
    });
    await auditTenantMutation('tenant.member.update', params.memberId);
    return decodeEndpointResponse('updateTenantMember', updated);
  }, managementContract("PATCH", "/v1/tenant/members/:memberId", {
    detail: { summary: 'Update project collaborator role', tags: ['Project'] },
  }))
  .delete('/members/:memberId', async ({ params }) => {
    const removed = await adapter.removeTenantMember(params.memberId);
    await auditTenantMutation('tenant.member.remove', params.memberId);
    return decodeEndpointResponse('removeTenantMember', removed);
  }, managementContract("DELETE", "/v1/tenant/members/:memberId", {
    detail: { summary: 'Remove a project collaborator', tags: ['Project'] },
  }))
  .get('/invitations', async ({ query: rawQuery }) => {
    const query = decodeManagementQuery('listTenantInvitations', rawQuery);
    const invitations = await adapter.listTenantInvitations({
      page: query.page,
      limit: query.limit,
      status: query.status,
    });
    return decodeEndpointResponse('listTenantInvitations', pagedResponse(invitations, { page: query.page, limit: query.limit }));
  }, managementContract("GET", "/v1/tenant/invitations", {
    detail: { summary: 'List project collaborator invitations', tags: ['Project'] },
  }))
  .post('/invitations', async ({ body }) => {
    const input = decodeEndpointBody('createTenantInvitation', body);
    const invitation = decodeEndpointResponse('createTenantInvitation', await adapter.createTenantInvitation({
      ...input, role: decodeSchema(TenantInvitationRoleSchema, input.role.trim().toLowerCase()),
    }));
    const invitationId = invitation.id;
    await auditTenantMutation('tenant.invitation.create', invitationId);
    return invitation;
  }, managementContract("POST", "/v1/tenant/invitations", {
    detail: { summary: 'Invite a project collaborator', tags: ['Project'] },
  }));

async function auditTenantMutation(eventType: string, resourceId: string) {
  await auditRepo.logAudit({ eventType, resourceType: 'tenant', resourceId, actorType: 'admin' });
}
