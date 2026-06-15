// User consent repository (P0-17) — backed by SupaCloud Postgres

import { eq, and, isNull, or } from 'drizzle-orm';
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
  // Match exact scope: when scopeId is omitted we must require NULL,
  // otherwise an org-scoped consent could satisfy an app-level check.
  if (params.scopeId) {
    conditions.push(eq(userConsents.scopeId, params.scopeId));
  } else {
    conditions.push(isNull(userConsents.scopeId));
  }
  if (params.organizationId) {
    conditions.push(eq(userConsents.organizationId, params.organizationId));
  } else {
    conditions.push(isNull(userConsents.organizationId));
  }

  const rows = await db.select({ id: userConsents.id }).from(userConsents)
    .where(and(...conditions)).limit(1);
  return rows.length > 0;
}

/** Grant consent — record a user's authorization decision.
 * Idempotent: if an active consent already exists for the same
 * user+app+scope+org, return it instead of inserting a duplicate.
 *
 * Concurrency: the check-then-insert is inherently racy, so we also catch the
 * unique_violation (Postgres SQLSTATE 23505) raised by the V4 partial unique
 * index `uq_user_consents_active` and re-select the winning row. This makes the
 * "return existing" contract hold even when two grants race.
 */
export async function grantConsent(params: {
  userId: string;
  applicationId: string;
  scopeId?: string;
  organizationId?: string;
}) {
  const db = getDb();
  const scopeId = params.scopeId || null;
  const organizationId = params.organizationId || null;

  const matchActive = () => db.select().from(userConsents)
    .where(and(
      eq(userConsents.userId, params.userId),
      eq(userConsents.applicationId, params.applicationId),
      scopeId ? eq(userConsents.scopeId, scopeId) : isNull(userConsents.scopeId),
      organizationId ? eq(userConsents.organizationId, organizationId) : isNull(userConsents.organizationId),
      isNull(userConsents.revokedAt),
    )).limit(1);

  // Check for an existing active consent
  const existing = await matchActive();
  if (existing.length > 0) return existing[0];

  try {
    const [consent] = await db.insert(userConsents).values({
      userId: params.userId,
      applicationId: params.applicationId,
      scopeId,
      organizationId,
    }).returning();
    return consent;
  } catch (err) {
    // Two concurrent grants may both miss the select and race to insert; the
    // V4 partial unique index lets only one win. Re-select the winner so the
    // caller still observes idempotent "return existing" semantics.
    // postgres.js surfaces SQLSTATE on the error object; drizzle re-throws it.
    const code = (err as { code?: string })?.code;
    if (code === '23505') {
      const winner = await matchActive();
      if (winner.length > 0) return winner[0];
    }
    throw err;
  }
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
