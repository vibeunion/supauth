// Account center support repository. SupaCloud remains the runtime user source;
// local rows track account-center session operations initiated by SupaOAuth.

import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { accountSessions } from '../db/schema.js';
import { logAudit } from './audit.js';

export async function listAccountSessions(userId: string) {
  const db = getDb();
  return db.select().from(accountSessions)
    .where(eq(accountSessions.userId, userId))
    .orderBy(desc(accountSessions.createdAt));
}

export async function recordAccountSession(userId: string, sessionId: string, metadata?: Record<string, unknown>) {
  const db = getDb();
  const [session] = await db.insert(accountSessions).values({
    userId,
    sessionId,
    metadata: metadata || {},
  }).returning();
  return session;
}

export async function revokeAccountSession(userId: string, sessionId: string) {
  const db = getDb();
  const [session] = await db.update(accountSessions).set({
    status: 'revoked',
    revokedAt: new Date(),
  }).where(and(
    eq(accountSessions.userId, userId),
    eq(accountSessions.sessionId, sessionId),
  )).returning();
  await logAudit({
    eventType: 'account.session.revoked',
    resourceType: 'user',
    resourceId: userId,
    details: { session_id: sessionId, local_session_found: Boolean(session) },
  });
  return session || null;
}
