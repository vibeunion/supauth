// Organization B2B control-plane repository: invitations, JIT provisioning,
// and organization-scoped application access.

import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  organizationApplications,
  organizationInvitations,
  organizationJitSettings,
} from '../db/schema.js';
import { logAudit } from './audit.js';

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function createInvitationToken() {
  return `inv_${randomBytes(24).toString('base64url')}`;
}

export async function listOrganizationInvitations(organizationId: string) {
  const db = getDb();
  return db.select({
    id: organizationInvitations.id,
    organizationId: organizationInvitations.organizationId,
    email: organizationInvitations.email,
    role: organizationInvitations.role,
    status: organizationInvitations.status,
    expiresAt: organizationInvitations.expiresAt,
    acceptedAt: organizationInvitations.acceptedAt,
    createdAt: organizationInvitations.createdAt,
  }).from(organizationInvitations)
    .where(eq(organizationInvitations.organizationId, organizationId))
    .orderBy(desc(organizationInvitations.createdAt));
}

export async function createOrganizationInvitation(organizationId: string, data: {
  email: string;
  role?: string;
  expiresAt?: Date | null;
}) {
  const db = getDb();
  const token = createInvitationToken();
  const [invitation] = await db.insert(organizationInvitations).values({
    organizationId,
    email: data.email,
    role: data.role || 'member',
    tokenHash: hashToken(token),
    expiresAt: data.expiresAt || null,
  }).returning({
    id: organizationInvitations.id,
    organizationId: organizationInvitations.organizationId,
    email: organizationInvitations.email,
    role: organizationInvitations.role,
    status: organizationInvitations.status,
    expiresAt: organizationInvitations.expiresAt,
    acceptedAt: organizationInvitations.acceptedAt,
    createdAt: organizationInvitations.createdAt,
  });
  await logAudit({
    eventType: 'organization.invitation.created',
    resourceType: 'organization',
    resourceId: organizationId,
    details: { email: data.email, role: invitation.role },
  });
  return { ...invitation, token };
}

export async function updateOrganizationInvitationStatus(organizationId: string, invitationId: string, status: string) {
  const db = getDb();
  const [invitation] = await db.update(organizationInvitations).set({
    status,
    acceptedAt: status === 'accepted' ? new Date() : null,
  }).where(and(
    eq(organizationInvitations.organizationId, organizationId),
    eq(organizationInvitations.id, invitationId),
  )).returning({
    id: organizationInvitations.id,
    organizationId: organizationInvitations.organizationId,
    email: organizationInvitations.email,
    role: organizationInvitations.role,
    status: organizationInvitations.status,
    expiresAt: organizationInvitations.expiresAt,
    acceptedAt: organizationInvitations.acceptedAt,
    createdAt: organizationInvitations.createdAt,
  });
  if (invitation) {
    await logAudit({
      eventType: `organization.invitation.${status}`,
      resourceType: 'organization',
      resourceId: organizationId,
      details: { invitation_id: invitationId },
    });
  }
  return invitation || null;
}

export async function getOrganizationJitSettings(organizationId: string) {
  const db = getDb();
  const rows = await db.select().from(organizationJitSettings)
    .where(eq(organizationJitSettings.organizationId, organizationId))
    .limit(1);
  return rows[0] || null;
}

export async function upsertOrganizationJitSettings(organizationId: string, data: {
  emailDomains?: string[];
  ssoConnectorIds?: string[];
  defaultRoleIds?: string[];
  enabled?: boolean;
}) {
  const db = getDb();
  const existing = await getOrganizationJitSettings(organizationId);
  const values = {
    organizationId,
    emailDomains: data.emailDomains ?? [],
    ssoConnectorIds: data.ssoConnectorIds ?? [],
    defaultRoleIds: data.defaultRoleIds ?? [],
    enabled: data.enabled ?? false,
    updatedAt: new Date(),
  };
  const [settings] = existing
    ? await db.update(organizationJitSettings).set(values)
      .where(eq(organizationJitSettings.id, existing.id)).returning()
    : await db.insert(organizationJitSettings).values(values).returning();
  await logAudit({
    eventType: 'organization.jit.updated',
    resourceType: 'organization',
    resourceId: organizationId,
    details: {
      enabled: values.enabled,
      email_domains: values.emailDomains,
      sso_connector_ids: values.ssoConnectorIds,
    },
  });
  return settings;
}

export async function listOrganizationApplications(organizationId: string) {
  const db = getDb();
  return db.select().from(organizationApplications)
    .where(eq(organizationApplications.organizationId, organizationId))
    .orderBy(desc(organizationApplications.createdAt));
}

export async function upsertOrganizationApplication(organizationId: string, applicationId: string, data: {
  roleIds?: string[];
  enabled?: boolean;
}) {
  const db = getDb();
  const rows = await db.select().from(organizationApplications).where(and(
    eq(organizationApplications.organizationId, organizationId),
    eq(organizationApplications.applicationId, applicationId),
  )).limit(1);
  const values = {
    organizationId,
    applicationId,
    roleIds: data.roleIds ?? [],
    enabled: data.enabled ?? true,
    updatedAt: new Date(),
  };
  const [record] = rows[0]
    ? await db.update(organizationApplications).set(values)
      .where(eq(organizationApplications.id, rows[0].id)).returning()
    : await db.insert(organizationApplications).values(values).returning();
  await logAudit({
    eventType: 'organization.application.updated',
    resourceType: 'organization',
    resourceId: organizationId,
    details: { application_id: applicationId, enabled: values.enabled, role_ids: values.roleIds },
  });
  return record;
}

export async function removeOrganizationApplication(organizationId: string, applicationId: string) {
  const db = getDb();
  const [record] = await db.delete(organizationApplications).where(and(
    eq(organizationApplications.organizationId, organizationId),
    eq(organizationApplications.applicationId, applicationId),
  )).returning();
  if (record) {
    await logAudit({
      eventType: 'organization.application.removed',
      resourceType: 'organization',
      resourceId: organizationId,
      details: { application_id: applicationId },
    });
  }
  return record || null;
}
