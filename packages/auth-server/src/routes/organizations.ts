// Organization management routes with OpenAPI annotations

import { Elysia, t } from 'elysia';
import { managementContract, decodeEndpointBody, decodeManagementBody, decodeEndpointResponse, decodeManagementQuery } from '../utils/management-contract.js';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as auditRepo from '../repositories/audit.js';
import { ApiContractError, capabilityUnavailable, pagedResponse, isRecord } from '../utils/api-contract.js';

const adapter = getSupaCloudAdapter();
const ORGANIZATION_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function auditStrict(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details });
}

async function requireOrganizationJitCapability() {
  const payload = await adapter.getCapabilities();
  if (!isRecord(payload)) throw invalidCapabilityResponse();
  const capabilities = payload["capabilities"];
  if (!isRecord(capabilities)) {
    throw invalidCapabilityResponse();
  }
  const capability = capabilities["business_organization_jit_v1"];
  if (isRecord(capability)) {
    const status = capability;
    if (status["available"] === true) return;
    const reasonCode = typeof status["reason_code"] === 'string'
      ? status["reason_code"]
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

function organizationCreatePayload(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) {
    throw new ApiContractError(
      400,
      'invalid_request_body',
      'Organization request body must be a JSON object',
    );
  }
  const organization = input;
  validateOrganizationName(organization["name"]);
  validateOrganizationSlug(organization["slug"]);
  return Object.hasOwn(organization, 'jit_domains')
    ? organization
    : { ...organization, jit_domains: [] };
}

function organizationUpdatePayload(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) {
    throw new ApiContractError(400, 'invalid_request_body', 'Organization request body must be a JSON object');
  }
  const organization = input;
  if (Object.hasOwn(organization, 'name')) validateOrganizationName(organization["name"]);
  if (Object.hasOwn(organization, 'slug')) validateOrganizationSlug(organization["slug"]);
  return organization;
}

function validateOrganizationName(name: unknown): void {
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 120) {
    throw new ApiContractError(400, 'invalid_organization_name', 'Organization name must contain 1 to 120 characters');
  }
}

function validateOrganizationSlug(slug: unknown): void {
  if (typeof slug !== 'string'
    || slug.length < 2
    || slug.length > 120
    || !ORGANIZATION_SLUG.test(slug)) {
    throw new ApiContractError(
      400,
      'invalid_organization_slug',
      'Organization slug must contain 2 to 120 lowercase URL-safe characters',
    );
  }
}

export const organizationRoutes = new Elysia({ prefix: '/v1/organizations' })
  .get('/', async ({ query: rawQuery }) => {
    const query = decodeManagementQuery('listOrganizations', rawQuery);
    const organizations = await adapter.listOrganizations({
      page: query.page,
      limit: query.limit,
      search: query.search,
      application_id: query.application_id,
    });
    return decodeEndpointResponse('listOrganizations', pagedResponse(organizations, { page: query.page, limit: query.limit }));
  }, managementContract("GET", "/v1/organizations", {
    detail: { summary: 'List organizations', tags: ['Organizations'] },
  }))
  .post('/', async ({ body }) => {
    const created = decodeEndpointResponse('createOrganization', await adapter.createOrganization(
      decodeManagementBody('createOrganization', organizationCreatePayload(body)),
    ));
    await auditStrict('organization.create', 'organization', created.id, { name: created.name });
    return created;
  }, managementContract("POST", "/v1/organizations", {
    detail: { summary: 'Create organization', tags: ['Organizations'] },
  }, ({ body }) => { organizationCreatePayload(body); }))
  .get('/:orgId', async ({ params }) => {
    return decodeEndpointResponse('getOrganization', await adapter.getOrganization(params.orgId));
  }, managementContract("GET", "/v1/organizations/:orgId", {
    detail: { summary: 'Get organization by ID', tags: ['Organizations'] },
  }))
  .put('/:orgId', async ({ params, body }) => {
    const updated = await adapter.updateOrganization(params.orgId, decodeManagementBody('updateOrganization', organizationUpdatePayload(body)));
    await auditStrict('organization.update', 'organization', params.orgId);
    return decodeEndpointResponse('updateOrganization', updated);
  }, managementContract("PUT", "/v1/organizations/:orgId", {
    detail: { summary: 'Update organization', tags: ['Organizations'] },
  }, ({ body }) => { organizationUpdatePayload(body); }))
  .delete('/:orgId', async ({ params }) => {
    const deleted = await adapter.deleteOrganization(params.orgId);
    await auditStrict('organization.delete', 'organization', params.orgId);
    return decodeEndpointResponse('deleteOrganization', deleted);
  }, managementContract("DELETE", "/v1/organizations/:orgId", {
    detail: { summary: 'Delete organization', tags: ['Organizations'] },
  }))
  // ─── Members ───
  .get('/:orgId/members', async ({ params, query: rawQuery }) => {
    const query = decodeManagementQuery('listOrganizationMembers', rawQuery);
    const members = await adapter.listOrganizationMembers(params.orgId, {
      page: query.page,
      limit: query.limit,
      search: query.search,
    });
    return decodeEndpointResponse('listOrganizationMembers', pagedResponse(members, { page: query.page, limit: query.limit }));
  }, managementContract("GET", "/v1/organizations/:orgId/members", {
    detail: { summary: 'List organization members', tags: ['Organizations', 'Members'] },
  }))
  .post('/:orgId/members', async ({ params, body }) => {
    const data = decodeEndpointBody('addOrganizationMember', body);
    const member = await adapter.addOrganizationMember(params.orgId, data);
    await auditStrict('organization.add_member', 'organization', params.orgId, { user_id: data.user_id });
    return decodeEndpointResponse('addOrganizationMember', member);
  }, managementContract("POST", "/v1/organizations/:orgId/members", {
    detail: { summary: 'Add member to organization', tags: ['Organizations', 'Members'] },
  }))
  .delete('/:orgId/members/:userId', async ({ params }) => {
    const removed = await adapter.removeOrganizationMember(params.orgId, params.userId);
    await auditStrict('organization.remove_member', 'organization', params.orgId, { user_id: params.userId });
    return decodeEndpointResponse('removeOrganizationMember', removed);
  }, managementContract("DELETE", "/v1/organizations/:orgId/members/:userId", {
    detail: { summary: 'Remove member from organization', tags: ['Organizations', 'Members'] },
  }))
  .patch('/:orgId/members/:userId', async ({ params, body }) => {
    return decodeEndpointResponse('updateOrganizationMemberRole', await adapter.updateOrganizationMember(params.orgId, params.userId, decodeEndpointBody('updateOrganizationMemberRole', body)));
  }, managementContract("PATCH", "/v1/organizations/:orgId/members/:userId", {
    body: t.Object({ role: t.String() }, { additionalProperties: false }),
    detail: { summary: 'Update member role in organization', tags: ['Organizations', 'Members'] },
  }))
  .get('/:orgId/roles', async ({ params }) => {
    return decodeEndpointResponse('getOrgRoleAssignments', pagedResponse(await adapter.getOrgRoleAssignments(params.orgId)));
  }, managementContract("GET", "/v1/organizations/:orgId/roles", {
    detail: { summary: 'Get role assignments for organization', tags: ['Organizations', 'RBAC'] },
  }))
  .get('/:orgId/invitations', async ({ params }) => {
    return decodeEndpointResponse('listOrganizationInvitations', pagedResponse(await adapter.listOrganizationInvitations(params.orgId)));
  }, managementContract("GET", "/v1/organizations/:orgId/invitations", {
    detail: { summary: 'List organization invitations', tags: ['Organizations', 'Invitations'] },
  }))
  .post('/:orgId/invitations', async ({ params, body }) => {
    const invitation = await adapter.createOrganizationInvitation(params.orgId, decodeEndpointBody('createOrganizationInvitation', body));
    await auditStrict('organization.invitation.create', 'organization', params.orgId, { email: body.email });
    return decodeEndpointResponse('createOrganizationInvitation', invitation);
  }, managementContract("POST", "/v1/organizations/:orgId/invitations", {
    body: t.Object({
      email: t.String(),
      role: t.Optional(t.String()),
      ttl_hours: t.Optional(t.Number({ minimum: 1, maximum: 720 })),
    }, { additionalProperties: false }),
    detail: { summary: 'Create organization invitation', tags: ['Organizations', 'Invitations'] },
  }))
  .delete('/:orgId/invitations/:invitationId', async ({ params }) => {
    return revokeInvitation(params.orgId, params.invitationId);
  }, managementContract("DELETE", "/v1/organizations/:orgId/invitations/:invitationId", {
    detail: { summary: 'Revoke an organization invitation', tags: ['Organizations', 'Invitations'] },
  }))
  .post('/:orgId/invitations/:invitationId/:action', async ({ params }) => {
    if (params.action === 'revoked') return revokeInvitation(params.orgId, params.invitationId);
    if (params.action === 'accepted') {
      throw capabilityUnavailable(
        'business_organization_invitation_legacy_acceptance_v1',
        'Invitation acceptance requires an authenticated GoTrue bearer at the /accept endpoint',
      );
    }
    throw capabilityUnavailable('business_organization_invitation_expiry_v1');
  }, managementContract("POST", "/v1/organizations/:orgId/invitations/:invitationId/:action", {
    detail: { hide: true },
  }))
  .get('/:orgId/jit', async ({ params }) => {
    await requireOrganizationJitCapability();
    return decodeEndpointResponse('getOrganizationJitSettings', await adapter.getOrganizationJitSettings(params.orgId));
  }, managementContract("GET", "/v1/organizations/:orgId/jit", {
    detail: { summary: 'Get organization JIT provisioning settings', tags: ['Organizations', 'JIT'] },
  }))
  .put('/:orgId/jit', async ({ params, body }) => {
    await requireOrganizationJitCapability();
    return decodeEndpointResponse('updateOrganizationJitSettings', await adapter.updateOrganizationJitSettings(params.orgId, decodeEndpointBody('updateOrganizationJitSettings', body)));
  }, managementContract("PUT", "/v1/organizations/:orgId/jit", {
    body: t.Object({
      enabled: t.Boolean(),
      domains: t.Array(t.String()),
    }, { additionalProperties: false }),
    detail: { summary: 'Update organization JIT provisioning settings', tags: ['Organizations', 'JIT'] },
  }))
  .get('/:orgId/applications', async ({ params }) => {
    return decodeEndpointResponse('listOrganizationApplications', pagedResponse(await adapter.listOrganizationApplications(params.orgId)));
  }, managementContract("GET", "/v1/organizations/:orgId/applications", {
    detail: { summary: 'List organization application access', tags: ['Organizations', 'Applications'] },
  }))
  .put('/:orgId/applications/:appId', async ({ params }) => {
    return decodeEndpointResponse('bindOrganizationApplication', await adapter.bindOrganizationApplication(params.orgId, params.appId));
  }, managementContract("PUT", "/v1/organizations/:orgId/applications/:appId", {
    detail: { summary: 'Grant or update organization application access', tags: ['Organizations', 'Applications'] },
  }))
  .delete('/:orgId/applications/:appId', async ({ params }) => {
    return decodeEndpointResponse('removeOrganizationApplication', await adapter.deleteOrganizationApplication(params.orgId, params.appId));
  }, managementContract("DELETE", "/v1/organizations/:orgId/applications/:appId", {
    detail: { summary: 'Remove organization application access', tags: ['Organizations', 'Applications'] },
  }))
  .get('/:orgId/branding', async ({ params }) => {
    return decodeEndpointResponse('getOrganizationBranding', await adapter.getOrganizationBranding(params.orgId));
  }, managementContract("GET", "/v1/organizations/:orgId/branding", {
    detail: { summary: 'Get organization branding', tags: ['Organizations'] },
  }))
  .put('/:orgId/branding', async ({ params, body }) => {
    const branding = await adapter.updateOrganizationBranding(params.orgId, decodeEndpointBody('updateOrganizationBranding', body));
    await auditStrict('organization.branding.update', 'organization', params.orgId);
    return decodeEndpointResponse('updateOrganizationBranding', branding);
  }, managementContract("PUT", "/v1/organizations/:orgId/branding", {
    detail: { summary: 'Update organization branding', tags: ['Organizations'] },
  }));

export const publicOrganizationRoutes = new Elysia({ prefix: '/v1/organizations' })
  .post('/:orgId/invitations/:invitationId/accept', async ({ params, body, headers }) => {
    const authorization = authenticatedGoTrueBearer(headers["authorization"]);
    const accepted = await adapter.acceptOrganizationInvitation(
      params.orgId,
      params.invitationId,
      decodeEndpointBody('acceptOrganizationInvitation', body),
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
    return decodeEndpointResponse('acceptOrganizationInvitation', accepted);
  }, managementContract("POST", "/v1/organizations/:orgId/invitations/:invitationId/accept", {
    body: t.Object({ token: t.String({ minLength: 1 }) }, { additionalProperties: false }),
    detail: { summary: 'Accept an organization invitation', tags: ['Organizations', 'Invitations'] },
  }));

function authenticatedGoTrueBearer(authorization: string | undefined): string {
  const token = authorization?.match(/^Bearer +([^\s]+)$/i)?.[1];
  if (!token) {
    throw new ApiContractError(401, 'gotrue_access_token_required', 'A GoTrue user access token is required');
  }
  return `Bearer ${token}`;
}

function acceptedInvitationUserId(accepted: unknown): string {
  if (!isRecord(accepted)) throw invalidInvitationResponse();
  const userId = accepted["user_id"];
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
  return decodeEndpointResponse('revokeOrganizationInvitation', revoked);
}
