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
  ttlHours?: number;
}) {
  const invitation = await getSupaCloudAdapter().createOrganizationInvitation(organizationId, {
    email: data.email,
    role: data.role,
    ttl_hours: data.ttlHours,
  });
  await logAudit({
    eventType: 'organization.invitation.created',
    resourceType: 'organization',
    resourceId: organizationId,
    details: { email: data.email, role: data.role || 'member' },
  });
  return invitation;
}

export async function getOrganizationJitSettings(organizationId: string) {
  return getSupaCloudAdapter().getOrganizationJitSettings(organizationId);
}

export async function upsertOrganizationJitSettings(organizationId: string, data: {
  domains: string[];
  enabled: boolean;
}) {
  const settings = await getSupaCloudAdapter().updateOrganizationJitSettings(organizationId, {
    domains: data.domains,
    enabled: data.enabled,
  });
  await logAudit({
    eventType: 'organization.jit.updated',
    resourceType: 'organization',
    resourceId: organizationId,
    details: {
      enabled: data.enabled,
      domains: data.domains,
    },
  });
  return settings;
}

export async function listOrganizationApplications(organizationId: string) {
  return getSupaCloudAdapter().listOrganizationApplications(organizationId);
}

export async function upsertOrganizationApplication(organizationId: string, applicationId: string) {
  const record = await getSupaCloudAdapter().bindOrganizationApplication(organizationId, applicationId);
  await logAudit({
    eventType: 'organization.application.updated',
    resourceType: 'organization',
    resourceId: organizationId,
    details: { application_id: applicationId },
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
