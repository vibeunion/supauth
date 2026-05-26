// Organization management routes with OpenAPI annotations

import { Elysia } from 'elysia';
import * as orgRepo from '../repositories/organizations.js';
import * as roleRepo from '../repositories/roles.js';
import * as orgControlRepo from '../repositories/organization-control.js';
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
  })
  .get('/:orgId/invitations', async ({ params }) => {
    const items = await orgControlRepo.listOrganizationInvitations(params.orgId);
    return { items, total: items.length };
  }, {
    detail: { summary: 'List organization invitations', tags: ['Organizations', 'Invitations'] },
  })
  .post('/:orgId/invitations', async ({ params, body }) => {
    const data = body as { email: string; role?: string; expires_at?: string };
    const invitation = await orgControlRepo.createOrganizationInvitation(params.orgId, {
      email: data.email,
      role: data.role,
      expiresAt: data.expires_at ? new Date(data.expires_at) : null,
    });
    await fireWebhook('organization.invitation_created', { org_id: params.orgId, email: data.email });
    return invitation;
  }, {
    detail: { summary: 'Create organization invitation', tags: ['Organizations', 'Invitations'] },
  })
  .post('/:orgId/invitations/:invitationId/:action', async ({ params }) => {
    if (!['accepted', 'revoked', 'expired'].includes(params.action)) {
      return new Response('Invalid invitation action', { status: 400 });
    }
    const invitation = await orgControlRepo.updateOrganizationInvitationStatus(params.orgId, params.invitationId, params.action);
    if (!invitation) return new Response('Not found', { status: 404 });
    return invitation;
  }, {
    detail: { summary: 'Update organization invitation status', tags: ['Organizations', 'Invitations'] },
  })
  .get('/:orgId/jit', async ({ params }) => {
    const settings = await orgControlRepo.getOrganizationJitSettings(params.orgId);
    return settings || {
      organizationId: params.orgId,
      emailDomains: [],
      ssoConnectorIds: [],
      defaultRoleIds: [],
      enabled: false,
    };
  }, {
    detail: { summary: 'Get organization JIT provisioning settings', tags: ['Organizations', 'JIT'] },
  })
  .put('/:orgId/jit', async ({ params, body }) => {
    const data = body as {
      email_domains?: string[];
      sso_connector_ids?: string[];
      default_role_ids?: string[];
      enabled?: boolean;
    };
    return orgControlRepo.upsertOrganizationJitSettings(params.orgId, {
      emailDomains: data.email_domains,
      ssoConnectorIds: data.sso_connector_ids,
      defaultRoleIds: data.default_role_ids,
      enabled: data.enabled,
    });
  }, {
    detail: { summary: 'Update organization JIT provisioning settings', tags: ['Organizations', 'JIT'] },
  })
  .get('/:orgId/applications', async ({ params }) => {
    const items = await orgControlRepo.listOrganizationApplications(params.orgId);
    return { items, total: items.length };
  }, {
    detail: { summary: 'List organization application access', tags: ['Organizations', 'Applications'] },
  })
  .put('/:orgId/applications/:appId', async ({ params, body }) => {
    const data = body as { role_ids?: string[]; enabled?: boolean };
    return orgControlRepo.upsertOrganizationApplication(params.orgId, params.appId, {
      roleIds: data.role_ids,
      enabled: data.enabled,
    });
  }, {
    detail: { summary: 'Grant or update organization application access', tags: ['Organizations', 'Applications'] },
  })
  .delete('/:orgId/applications/:appId', async ({ params }) => {
    const record = await orgControlRepo.removeOrganizationApplication(params.orgId, params.appId);
    if (!record) return new Response('Not found', { status: 404 });
    return record;
  }, {
    detail: { summary: 'Remove organization application access', tags: ['Organizations', 'Applications'] },
  });
