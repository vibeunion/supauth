// User consent repository (P0-17) — backed by SupaCloud Postgres

import { eq, and, isNull } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { userConsents } from '../db/schema.js';

export interface UserConsent {
  id: string;
  userId: string;
  applicationId: string;
  scopeId: string | null;
  organizationId: string | null;
  grantedAt: Date;
  revokedAt: Date | null;
}

/** List active (non-revoked) consents for a user */
export async function listUserConsents(userId: string) {
  const db = getDb();
  return db.select().from(userConsents)
    .where(and(eq(userConsents.userId, userId), isNull(userConsents.revokedAt)))
    .orderBy(userConsents.grantedAt);
}

/** List all consents (including revoked) for a user */
export async function listAllUserConsents(userId: string) {
  const db = getDb();
  return db.select().from(userConsents)
    .where(eq(userConsents.userId, userId))
    .orderBy(userConsents.grantedAt);
}

/** Check if a user has active consent for a specific application/scope/org */
export async function hasConsent(params: {
  userId: string;
  applicationId: string;
  scopeId?: string;
  organizationId?: string;
}): Promise<boolean> {
  const db = getDb();
  const conditions = [
    eq(userConsents.userId, params.userId),
    eq(userConsents.applicationId, params.applicationId),
    isNull(userConsents.revokedAt),
  ];
  if (params.scopeId) conditions.push(eq(userConsents.scopeId, params.scopeId));
  if (params.organizationId) conditions.push(eq(userConsents.organizationId, params.organizationId));

  const rows = await db.select({ id: userConsents.id }).from(userConsents)
    .where(and(...conditions)).limit(1);
  return rows.length > 0;
}

/** Grant consent — record a user's authorization decision */
export async function grantConsent(params: {
  userId: string;
  applicationId: string;
  scopeId?: string;
  organizationId?: string;
}) {
  const db = getDb();
  const [consent] = await db.insert(userConsents).values({
    userId: params.userId,
    applicationId: params.applicationId,
    scopeId: params.scopeId || null,
    organizationId: params.organizationId || null,
  }).returning();
  return consent;
}

/** Revoke a specific consent */
export async function revokeConsent(consentId: string) {
  const db = getDb();
  const [updated] = await db.update(userConsents)
    .set({ revokedAt: new Date() })
    .where(eq(userConsents.id, consentId))
    .returning();
  return updated;
}

/** Revoke all consents for a user+application combination */
export async function revokeAllConsents(userId: string, applicationId: string) {
  const db = getDb();
  // Find active consents and revoke them
  const active = await db.select().from(userConsents)
    .where(and(eq(userConsents.userId, userId), eq(userConsents.applicationId, applicationId), isNull(userConsents.revokedAt)));

  for (const consent of active) {
    await db.update(userConsents)
      .set({ revokedAt: new Date() })
      .where(eq(userConsents.id, consent.id));
  }
  return active.length;
}

/** List consents for admin view (all users for an application) */
export async function listApplicationConsents(applicationId: string) {
  const db = getDb();
  return db.select().from(userConsents)
    .where(eq(userConsents.applicationId, applicationId))
    .orderBy(userConsents.grantedAt);
}
