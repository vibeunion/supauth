// SupaOAuth application consent policy overlay.

import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { applicationConsentSettings } from '../db/schema.js';
import { logAudit } from './audit.js';

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
