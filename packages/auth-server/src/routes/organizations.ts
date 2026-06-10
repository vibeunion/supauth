// Organization management routes with OpenAPI annotations

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

export const organizationRoutes = new Elysia({ prefix: '/v1/organizations' })
  .get('/', async () => {
    return toListResponse(await adapter.listOrganizations());
  }, {
    detail: { summary: 'List organizations', tags: ['Organizations'] },
  })
  .post('/', async ({ body }) => {
    const created = await adapter.createOrganization(body as Record<string, unknown>);
    const record = created as Record<string, unknown>;
    await audit('organization.create', 'organization', String(record.id || ''), { name: record.name });
    await fireWebhook('organization.created', { org_id: record.id, name: record.name });
    return created;
  }, {
    detail: { summary: 'Create organization', tags: ['Organizations'] },
  })
  .get('/:orgId', async ({ params }) => {
    return adapter.getOrganization(params.orgId);
  }, {
    detail: { summary: 'Get organization by ID', tags: ['Organizations'] },
  })
  .put('/:orgId', async ({ params, body }) => {
    const updated = await adapter.updateOrganization(params.orgId, body as Record<string, unknown>);
    await audit('organization.update', 'organization', params.orgId);
    return updated;
  }, {
    detail: { summary: 'Update organization', tags: ['Organizations'] },
  })
  .delete('/:orgId', async ({ params }) => {
    await adapter.deleteOrganization(params.orgId);
    await audit('organization.delete', 'organization', params.orgId);
  }, {
    detail: { summary: 'Delete organization', tags: ['Organizations'] },
  })
  // ─── Members ───
  .post('/:orgId/members', async ({ params, body }) => {
    const data = body as { user_id: string; role?: string };
    const member = await adapter.addOrganizationMember(params.orgId, data as Record<string, unknown>);
    await audit('organization.add_member', 'organization', params.orgId, { user_id: data.user_id });
    await fireWebhook('organization.member_added', { org_id: params.orgId, user_id: data.user_id });
    return member;
  }, {
    detail: { summary: 'Add member to organization', tags: ['Organizations', 'Members'] },
  })
  .delete('/:orgId/members/:userId', async ({ params }) => {
    await adapter.removeOrganizationMember(params.orgId, params.userId);
    await audit('organization.remove_member', 'organization', params.orgId, { user_id: params.userId });
    await fireWebhook('organization.member_removed', { org_id: params.orgId, user_id: params.userId });
  }, {
    detail: { summary: 'Remove member from organization', tags: ['Organizations', 'Members'] },
  })
  .patch('/:orgId/members/:userId', async ({ params, body }) => {
    return adapter.updateOrganizationMember(params.orgId, params.userId, body as Record<string, unknown>);
  }, {
    detail: { summary: 'Update member role in organization', tags: ['Organizations', 'Members'] },
  })
  .get('/:orgId/roles', async ({ params }) => {
    return toListResponse(await adapter.getOrgRoleAssignments(params.orgId));
  }, {
    detail: { summary: 'Get role assignments for organization', tags: ['Organizations', 'RBAC'] },
  })
  .get('/:orgId/invitations', async ({ params }) => {
    return toListResponse(await adapter.listOrganizationInvitations(params.orgId));
  }, {
    detail: { summary: 'List organization invitations', tags: ['Organizations', 'Invitations'] },
  })
  .post('/:orgId/invitations', async ({ params, body }) => {
    const data = body as { email: string; role?: string; expires_at?: string };
    const invitation = await adapter.createOrganizationInvitation(params.orgId, data as Record<string, unknown>);
    await fireWebhook('organization.invitation_created', { org_id: params.orgId, email: data.email });
    return invitation;
  }, {
    detail: { summary: 'Create organization invitation', tags: ['Organizations', 'Invitations'] },
  })
  .post('/:orgId/invitations/:invitationId/:action', async ({ params }) => {
    if (!['accepted', 'revoked', 'expired'].includes(params.action)) {
      return new Response('Invalid invitation action', { status: 400 });
    }
    return adapter.updateOrganizationInvitationStatus(params.orgId, params.invitationId, params.action);
  }, {
    detail: { summary: 'Update organization invitation status', tags: ['Organizations', 'Invitations'] },
  })
  .get('/:orgId/jit', async ({ params }) => {
    return adapter.getOrganizationJitSettings(params.orgId);
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
    return adapter.updateOrganizationJitSettings(params.orgId, data as Record<string, unknown>);
  }, {
    detail: { summary: 'Update organization JIT provisioning settings', tags: ['Organizations', 'JIT'] },
  })
  .get('/:orgId/applications', async ({ params }) => {
    return toListResponse(await adapter.listOrganizationApplications(params.orgId));
  }, {
    detail: { summary: 'List organization application access', tags: ['Organizations', 'Applications'] },
  })
  .put('/:orgId/applications/:appId', async ({ params, body }) => {
    return adapter.updateOrganizationApplication(params.orgId, params.appId, body as Record<string, unknown>);
  }, {
    detail: { summary: 'Grant or update organization application access', tags: ['Organizations', 'Applications'] },
  })
  .delete('/:orgId/applications/:appId', async ({ params }) => {
    return adapter.deleteOrganizationApplication(params.orgId, params.appId);
  }, {
    detail: { summary: 'Remove organization application access', tags: ['Organizations', 'Applications'] },
  });
