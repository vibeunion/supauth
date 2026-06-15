// Application runtime controls: client secret lifecycle and consent settings.

import { randomBytes, createHash } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { applicationConsentSettings, applicationSecrets } from '../db/schema.js';
import { logAudit } from './audit.js';

function generateSecret() {
  return `so_${randomBytes(32).toString('base64url')}`;
}

function generateSecretId() {
  return `sec_${randomBytes(12).toString('base64url')}`;
}

/** SHA-256 hash a plaintext secret for secure at-rest storage. */
function hashSecret(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/** Strip secretHash from any application_secret row before it crosses the API
 * boundary. Every secret-lifecycle endpoint must go through this so the hash
 * is never leaked even if new endpoints are added later.
 */
function sanitizeSecret<T extends { secretHash?: string | null }>(
  row: T,
): Omit<T, 'secretHash'> {
  const { secretHash: _omit, ...rest } = row;
  return rest;
}

export async function listApplicationSecrets(applicationId: string) {
  const db = getDb();
  // Expose only whether a hash is present (legacy rows may not have one), never
  // the hash string itself. Returning the raw hash to the API surface would
  // let a compromised/leaked response be used for offline verification attempts.
  return db.select({
    id: applicationSecrets.id,
    applicationId: applicationSecrets.applicationId,
    secretId: applicationSecrets.secretId,
    name: applicationSecrets.name,
    status: applicationSecrets.status,
    lastUsedAt: applicationSecrets.lastUsedAt,
    expiresAt: applicationSecrets.expiresAt,
    createdAt: applicationSecrets.createdAt,
    disabledAt: applicationSecrets.disabledAt,
    hasHash: sql<boolean>`${applicationSecrets.secretHash} IS NOT NULL`,
  }).from(applicationSecrets)
    .where(eq(applicationSecrets.applicationId, applicationId))
    .orderBy(desc(applicationSecrets.createdAt));
}

export async function createApplicationSecret(applicationId: string, data: { name?: string; expiresAt?: Date | null }) {
  const db = getDb();
  const secretId = generateSecretId();
  const secret = generateSecret();
  const [entry] = await db.insert(applicationSecrets).values({
    applicationId,
    secretId,
    secretHash: hashSecret(secret),
    name: data.name || 'Client secret',
    expiresAt: data.expiresAt || null,
  }).returning();
  await logAudit({
    eventType: 'application.secret.created',
    resourceType: 'application',
    resourceId: applicationId,
    details: { secret_id: secretId, name: entry.name },
  });
  // Return only metadata + the one-time plaintext secret. The stored hash must
  // never leave this function; callers/API consumers only get a boolean-like
  // view of the secret via listApplicationSecrets.
  return { ...sanitizeSecret(entry), secret };
}

export async function disableApplicationSecret(applicationId: string, secretId: string) {
  const db = getDb();
  const [entry] = await db.update(applicationSecrets).set({
    status: 'disabled',
    disabledAt: new Date(),
  }).where(and(
    eq(applicationSecrets.applicationId, applicationId),
    eq(applicationSecrets.secretId, secretId),
  )).returning();
  if (entry) {
    await logAudit({
      eventType: 'application.secret.disabled',
      resourceType: 'application',
      resourceId: applicationId,
      details: { secret_id: secretId },
    });
    // Never return the hash; only metadata so callers know which secret changed.
    return sanitizeSecret(entry);
  }
  return null;
}

export async function deleteApplicationSecret(applicationId: string, secretId: string) {
  const db = getDb();
  const [entry] = await db.update(applicationSecrets).set({
    status: 'deleted',
    disabledAt: new Date(),
  }).where(and(
    eq(applicationSecrets.applicationId, applicationId),
    eq(applicationSecrets.secretId, secretId),
  )).returning();
  if (entry) {
    await logAudit({
      eventType: 'application.secret.deleted',
      resourceType: 'application',
      resourceId: applicationId,
      details: { secret_id: secretId },
    });
    // Never return the hash; only metadata so callers know which secret changed.
    return sanitizeSecret(entry);
  }
  return null;
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


/** Verify a plaintext secret against stored hashes for an application.
 * Returns the matching secret record on success, null otherwise.
 * Updates lastUsedAt on match.
 */
export async function verifyApplicationSecret(applicationId: string, plaintext: string) {
  const db = getDb();
  const candidateHash = hashSecret(plaintext);
  const rows = await db.select().from(applicationSecrets)
    .where(and(
      eq(applicationSecrets.applicationId, applicationId),
      eq(applicationSecrets.status, 'active'),
    ));
  for (const row of rows) {
    if (row.secretHash === candidateHash) {
      await db.update(applicationSecrets).set({ lastUsedAt: new Date() })
        .where(eq(applicationSecrets.id, row.id));
      return row;
    }
  }
  return null;
}
