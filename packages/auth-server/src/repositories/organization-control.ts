// Organization B2B control-plane compatibility facade.
//
// SupaCloud owns invitations, JIT settings, and organization application
// grants. These exports are retained for older internal callers only.

import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import { logAudit } from './audit.js';

export async function listOrganizationInvitations(organizationId: string) {
  return getSupaCloudAdapter().listOrganizationInvitations(organizationId);
}

export async function createOrganizationInvitation(organizationId: string, data: {
  email: string;
  role?: string;
  expiresAt?: Date | null;
}) {
  const invitation = await getSupaCloudAdapter().createOrganizationInvitation(organizationId, {
    email: data.email,
    role: data.role,
    expires_at: data.expiresAt?.toISOString() ?? null,
  });
  await logAudit({
    eventType: 'organization.invitation.created',
    resourceType: 'organization',
    resourceId: organizationId,
    details: { email: data.email, role: data.role || 'member' },
  });
  return invitation;
}

export async function updateOrganizationInvitationStatus(organizationId: string, invitationId: string, status: string) {
  const invitation = await getSupaCloudAdapter().updateOrganizationInvitationStatus(organizationId, invitationId, status);
  await logAudit({
    eventType: `organization.invitation.${status}`,
    resourceType: 'organization',
    resourceId: organizationId,
    details: { invitation_id: invitationId },
  });
  return invitation;
}

export async function getOrganizationJitSettings(organizationId: string) {
  return getSupaCloudAdapter().getOrganizationJitSettings(organizationId);
}

export async function upsertOrganizationJitSettings(organizationId: string, data: {
  emailDomains?: string[];
  ssoConnectorIds?: string[];
  defaultRoleIds?: string[];
  enabled?: boolean;
}) {
  const settings = await getSupaCloudAdapter().updateOrganizationJitSettings(organizationId, {
    email_domains: data.emailDomains ?? [],
    sso_connector_ids: data.ssoConnectorIds ?? [],
    default_role_ids: data.defaultRoleIds ?? [],
    enabled: data.enabled ?? false,
  });
  await logAudit({
    eventType: 'organization.jit.updated',
    resourceType: 'organization',
    resourceId: organizationId,
    details: {
      enabled: data.enabled ?? false,
      email_domains: data.emailDomains ?? [],
      sso_connector_ids: data.ssoConnectorIds ?? [],
    },
  });
  return settings;
}

export async function listOrganizationApplications(organizationId: string) {
  return getSupaCloudAdapter().listOrganizationApplications(organizationId);
}

export async function upsertOrganizationApplication(organizationId: string, applicationId: string, data: {
  roleIds?: string[];
  enabled?: boolean;
}) {
  const record = await getSupaCloudAdapter().updateOrganizationApplication(organizationId, applicationId, {
    role_ids: data.roleIds ?? [],
    enabled: data.enabled ?? true,
  });
  await logAudit({
    eventType: 'organization.application.updated',
    resourceType: 'organization',
    resourceId: organizationId,
    details: { application_id: applicationId, enabled: data.enabled ?? true, role_ids: data.roleIds ?? [] },
  });
  return record;
}

export async function removeOrganizationApplication(organizationId: string, applicationId: string) {
  const record = await getSupaCloudAdapter().deleteOrganizationApplication(organizationId, applicationId);
  await logAudit({
    eventType: 'organization.application.removed',
    resourceType: 'organization',
    resourceId: organizationId,
    details: { application_id: applicationId },
  });
  return record;
}
