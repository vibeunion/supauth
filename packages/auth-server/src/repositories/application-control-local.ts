// Legacy local application-secret helpers retained for migration compatibility.
// New runtime lifecycle APIs live in application-control.ts and proxy SupaCloud.

import { randomBytes, createHash } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { applicationSecrets } from '../db/schema.js';

function generateSecret() {
  return `so_${randomBytes(32).toString('base64url')}`;
}

function generateSecretId() {
  return `sec_${randomBytes(12).toString('base64url')}`;
}

function hashSecret(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

function sanitizeSecret<T extends { secretHash?: string | null }>(row: T): Omit<T, 'secretHash'> {
  const { secretHash: _omit, ...rest } = row;
  return rest;
}

export async function listLocalApplicationSecrets(applicationId: string) {
  const db = getDb();
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

export async function createLocalApplicationSecret(applicationId: string, data: { name?: string; expiresAt?: Date | null }) {
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
  return { ...sanitizeSecret(entry), secret };
}

export async function disableLocalApplicationSecret(applicationId: string, secretId: string) {
  const db = getDb();
  const [entry] = await db.update(applicationSecrets).set({
    status: 'disabled',
    disabledAt: new Date(),
  }).where(and(
    eq(applicationSecrets.applicationId, applicationId),
    eq(applicationSecrets.secretId, secretId),
  )).returning();
  return entry ? sanitizeSecret(entry) : null;
}

export async function deleteLocalApplicationSecret(applicationId: string, secretId: string) {
  const db = getDb();
  const [entry] = await db.update(applicationSecrets).set({
    status: 'deleted',
    disabledAt: new Date(),
  }).where(and(
    eq(applicationSecrets.applicationId, applicationId),
    eq(applicationSecrets.secretId, secretId),
  )).returning();
  return entry ? sanitizeSecret(entry) : null;
}

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
      return sanitizeSecret(row);
    }
  }
  return null;
}
