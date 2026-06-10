// Application runtime controls.
//
// SupaCloud owns OAuth client secret lifecycle. SupAuth only stores consent
// overlays that do not exist in GoTrue/SupaCloud management state.

import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { applicationConsentSettings } from '../db/schema.js';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import { logAudit } from './audit.js';

export async function listApplicationSecrets(applicationId: string) {
  return getSupaCloudAdapter().listClientSecrets(applicationId);
}

export async function createApplicationSecret(applicationId: string, data: { name?: string; expiresAt?: Date | null }) {
  const secret = await getSupaCloudAdapter().createClientSecret(applicationId, {
    name: data.name,
    expires_at: data.expiresAt?.toISOString() ?? null,
  });
  await logAudit({
    eventType: 'application.secret.created',
    resourceType: 'application',
    resourceId: applicationId,
    details: { name: data.name },
  });
  return secret;
}

export async function disableApplicationSecret(applicationId: string, secretId: string) {
  const secret = await getSupaCloudAdapter().disableClientSecret(applicationId, secretId);
  await logAudit({
    eventType: 'application.secret.disabled',
    resourceType: 'application',
    resourceId: applicationId,
    details: { secret_id: secretId },
  });
  return secret;
}

export async function deleteApplicationSecret(applicationId: string, secretId: string) {
  const secret = await getSupaCloudAdapter().deleteClientSecret(applicationId, secretId);
  await logAudit({
    eventType: 'application.secret.deleted',
    resourceType: 'application',
    resourceId: applicationId,
    details: { secret_id: secretId },
  });
  return secret;
}

export async function getApplicationConsentSettings(applicationId: string) {
  const db = getDb();
  const rows = await db.select().from(applicationConsentSettings)
    .where(eq(applicationConsentSettings.applicationId, applicationId))
    .limit(1);
  return rows[0] || null;
}

export async function upsertApplicationConsentSettings(applicationId: string, data: {
  userScopes?: string[];
  organizationScopes?: string[];
  allowedOrganizationIds?: string[];
  requireExplicitConsent?: boolean;
  customData?: Record<string, unknown>;
}) {
  const db = getDb();
  const existing = await getApplicationConsentSettings(applicationId);
  const values = {
    applicationId,
    userScopes: data.userScopes ?? [],
    organizationScopes: data.organizationScopes ?? [],
    allowedOrganizationIds: data.allowedOrganizationIds ?? [],
    requireExplicitConsent: data.requireExplicitConsent ?? true,
    customData: data.customData ?? {},
    updatedAt: new Date(),
  };
  const [settings] = existing
    ? await db.update(applicationConsentSettings).set(values)
      .where(eq(applicationConsentSettings.id, existing.id)).returning()
    : await db.insert(applicationConsentSettings).values(values).returning();
  await logAudit({
    eventType: 'application.consent.updated',
    resourceType: 'application',
    resourceId: applicationId,
    details: {
      user_scopes: values.userScopes,
      organization_scopes: values.organizationScopes,
      require_explicit_consent: values.requireExplicitConsent,
    },
  });
  return settings;
}
