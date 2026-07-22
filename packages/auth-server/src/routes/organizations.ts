// Organization management routes with OpenAPI annotations

import { Elysia, t } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as auditRepo from '../repositories/audit.js';
import { ApiContractError, capabilityUnavailable, pagedResponse } from '../utils/api-contract.js';

const adapter = getSupaCloudAdapter();

async function auditStrict(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details });
}

async function requireOrganizationJitCapability() {
  const payload = await adapter.getCapabilities();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalidCapabilityResponse();
  const capabilities = (payload as Record<string, unknown>).capabilities;
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    throw invalidCapabilityResponse();
  }
  const capability = (capabilities as Record<string, unknown>).business_organization_jit_v1;
  if (capability && typeof capability === 'object' && !Array.isArray(capability)) {
    const status = capability as Record<string, unknown>;
    if (status.available === true) return;
    const reasonCode = typeof status.reason_code === 'string'
      ? status.reason_code
      : 'business_organization_jit_unavailable';
    throw new ApiContractError(
      501,
      'capability_unavailable',
      'GoTrue organization JIT runtime is unavailable',
      { capability: 'business_organization_jit_v1', reason_code: reasonCode },
    );
  }
  throw invalidCapabilityResponse();
}

function invalidCapabilityResponse() {
  return new ApiContractError(502, 'invalid_upstream_response', 'SupaCloud capability response has an invalid shape');
}

export const organizationRoutes = new Elysia({ prefix: '/v1/organizations' })
  .get('/', async ({ query }) => {
    const organizations = await adapter.listOrganizations({
      page: query.page,
      limit: query.limit,
      search: query.search,
      application_id: query.application_id,
    });
    return pagedResponse(organizations, { page: query.page, limit: query.limit });
  }, {
    detail: { summary: 'List organizations', tags: ['Organizations'] },
  })
  .post('/', async ({ body }) => {
    const created = await adapter.createOrganization(body as Record<string, unknown>);
    const record = created as Record<string, unknown>;
    await auditStrict('organization.create', 'organization', String(record.id || ''), { name: record.name });
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
    await auditStrict('organization.update', 'organization', params.orgId);
    return updated;
  }, {
    detail: { summary: 'Update organization', tags: ['Organizations'] },
  })
  .delete('/:orgId', async ({ params }) => {
    const deleted = await adapter.deleteOrganization(params.orgId);
    await auditStrict('organization.delete', 'organization', params.orgId);
    return deleted;
  }, {
    detail: { summary: 'Delete organization', tags: ['Organizations'] },
  })
  // ─── Members ───
  .get('/:orgId/members', async ({ params, query }) => {
    const members = await adapter.listOrganizationMembers(params.orgId, {
      page: query.page,
      limit: query.limit,
      search: query.search,
    });
    return pagedResponse(members, { page: query.page, limit: query.limit });
  }, {
    detail: { summary: 'List organization members', tags: ['Organizations', 'Members'] },
  })
  .post('/:orgId/members', async ({ params, body }) => {
    const data = body as { user_id: string; role?: string };
    const member = await adapter.addOrganizationMember(params.orgId, data as Record<string, unknown>);
    await auditStrict('organization.add_member', 'organization', params.orgId, { user_id: data.user_id });
    return member;
  }, {
    detail: { summary: 'Add member to organization', tags: ['Organizations', 'Members'] },
  })
  .delete('/:orgId/members/:userId', async ({ params }) => {
    const removed = await adapter.removeOrganizationMember(params.orgId, params.userId);
    await auditStrict('organization.remove_member', 'organization', params.orgId, { user_id: params.userId });
    return removed;
  }, {
    detail: { summary: 'Remove member from organization', tags: ['Organizations', 'Members'] },
  })
  .patch('/:orgId/members/:userId', async ({ params, body }) => {
    return adapter.updateOrganizationMember(params.orgId, params.userId, body);
  }, {
    body: t.Object({ role: t.String() }, { additionalProperties: false }),
    detail: { summary: 'Update member role in organization', tags: ['Organizations', 'Members'] },
  })
  .get('/:orgId/roles', async ({ params }) => {
    return pagedResponse(await adapter.getOrgRoleAssignments(params.orgId));
  }, {
    detail: { summary: 'Get role assignments for organization', tags: ['Organizations', 'RBAC'] },
  })
  .get('/:orgId/invitations', async ({ params }) => {
    return pagedResponse(await adapter.listOrganizationInvitations(params.orgId));
  }, {
    detail: { summary: 'List organization invitations', tags: ['Organizations', 'Invitations'] },
  })
  .post('/:orgId/invitations', async ({ params, body }) => {
    const invitation = await adapter.createOrganizationInvitation(params.orgId, body);
    await auditStrict('organization.invitation.create', 'organization', params.orgId, { email: body.email });
    return invitation;
  }, {
    body: t.Object({
      email: t.String(),
      role: t.Optional(t.String()),
      ttl_hours: t.Optional(t.Number({ minimum: 1, maximum: 720 })),
    }, { additionalProperties: false }),
    detail: { summary: 'Create organization invitation', tags: ['Organizations', 'Invitations'] },
  })
  .delete('/:orgId/invitations/:invitationId', async ({ params }) => {
    return revokeInvitation(params.orgId, params.invitationId);
  }, {
    detail: { summary: 'Revoke an organization invitation', tags: ['Organizations', 'Invitations'] },
  })
  .post('/:orgId/invitations/:invitationId/:action', async ({ params }) => {
    if (params.action === 'revoked') return revokeInvitation(params.orgId, params.invitationId);
    if (params.action === 'accepted') {
      throw capabilityUnavailable(
        'business_organization_invitation_legacy_acceptance_v1',
        'Invitation acceptance requires an authenticated GoTrue bearer at the /accept endpoint',
      );
    }
    throw capabilityUnavailable('business_organization_invitation_expiry_v1');
  }, {
    detail: { hide: true },
  })
  .get('/:orgId/jit', async ({ params }) => {
    await requireOrganizationJitCapability();
    return adapter.getOrganizationJitSettings(params.orgId);
  }, {
    detail: { summary: 'Get organization JIT provisioning settings', tags: ['Organizations', 'JIT'] },
  })
  .put('/:orgId/jit', async ({ params, body }) => {
    await requireOrganizationJitCapability();
    return adapter.updateOrganizationJitSettings(params.orgId, body);
  }, {
    body: t.Object({
      enabled: t.Boolean(),
      domains: t.Array(t.String()),
    }, { additionalProperties: false }),
    detail: { summary: 'Update organization JIT provisioning settings', tags: ['Organizations', 'JIT'] },
  })
  .get('/:orgId/applications', async ({ params }) => {
    return pagedResponse(await adapter.listOrganizationApplications(params.orgId));
  }, {
    detail: { summary: 'List organization application access', tags: ['Organizations', 'Applications'] },
  })
  .put('/:orgId/applications/:appId', async ({ params }) => {
    return adapter.bindOrganizationApplication(params.orgId, params.appId);
  }, {
    detail: { summary: 'Grant or update organization application access', tags: ['Organizations', 'Applications'] },
  })
  .delete('/:orgId/applications/:appId', async ({ params }) => {
    return adapter.deleteOrganizationApplication(params.orgId, params.appId);
  }, {
    detail: { summary: 'Remove organization application access', tags: ['Organizations', 'Applications'] },
  })
  .get('/:orgId/branding', async ({ params }) => {
    return adapter.getOrganizationBranding(params.orgId);
  }, {
    detail: { summary: 'Get organization branding', tags: ['Organizations'] },
  })
  .put('/:orgId/branding', async ({ params, body }) => {
    const branding = await adapter.updateOrganizationBranding(params.orgId, body as Record<string, unknown>);
    await auditStrict('organization.branding.update', 'organization', params.orgId);
    return branding;
  }, {
    detail: { summary: 'Update organization branding', tags: ['Organizations'] },
  });

export const publicOrganizationRoutes = new Elysia({ prefix: '/v1/organizations' })
  .post('/:orgId/invitations/:invitationId/accept', async ({ params, body, headers }) => {
    const authorization = authenticatedGoTrueBearer(headers.authorization);
    const accepted = await adapter.acceptOrganizationInvitation(
      params.orgId,
      params.invitationId,
      { token: body.token },
      authorization,
    );
    const userId = acceptedInvitationUserId(accepted);
    await auditRepo.logAudit({
      eventType: 'organization.invitation.accept',
      actorId: userId,
      actorType: 'user',
      resourceType: 'organization',
      resourceId: params.orgId,
      details: { invitation_id: params.invitationId },
    });
    return accepted;
  }, {
    body: t.Object({ token: t.String({ minLength: 1 }) }, { additionalProperties: false }),
    detail: { summary: 'Accept an organization invitation', tags: ['Organizations', 'Invitations'] },
  });

function authenticatedGoTrueBearer(authorization: string | undefined): string {
  const token = authorization?.match(/^Bearer +([^\s]+)$/i)?.[1];
  if (!token) {
    throw new ApiContractError(401, 'gotrue_access_token_required', 'A GoTrue user access token is required');
  }
  return `Bearer ${token}`;
}

function acceptedInvitationUserId(accepted: unknown): string {
  if (!accepted || typeof accepted !== 'object') throw invalidInvitationResponse();
  const userId = (accepted as Record<string, unknown>).user_id;
  if (typeof userId !== 'string' || !userId) throw invalidInvitationResponse();
  return userId;
}

function invalidInvitationResponse() {
  return new ApiContractError(
    502,
    'invalid_upstream_response',
    'SupaCloud invitation acceptance response has an invalid shape',
  );
}

async function revokeInvitation(orgId: string, invitationId: string) {
  const revoked = await adapter.revokeOrganizationInvitation(orgId, invitationId);
  await auditStrict('organization.invitation.revoke', 'organization', orgId, { invitation_id: invitationId });
  return revoked;
}
