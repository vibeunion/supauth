// Passkeys repository (P1-9) — backed by SupaCloud Postgres
// Stores WebAuthn credential metadata; actual crypto verification happens in auth flow

import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { passkeys } from '../db/schema.js';

/** List all passkeys for a user */
export async function listUserPasskeys(userId: string) {
  const db = getDb();
  return db.select().from(passkeys)
    .where(eq(passkeys.userId, userId))
    .orderBy(passkeys.createdAt);
}

/** Get a passkey by ID */
export async function getPasskey(id: string) {
  const db = getDb();
  const rows = await db.select().from(passkeys).where(eq(passkeys.id, id)).limit(1);
  return rows[0] || null;
}

/** Register a new passkey */
export async function registerPasskey(data: {
  userId: string;
  credentialId: string;
  publicKey: string;
  counter?: number;
  deviceType?: string;
  backedUp?: boolean;
  name?: string;
  transports?: string[];
}) {
  const db = getDb();
  const [passkey] = await db.insert(passkeys).values({
    userId: data.userId,
    credentialId: data.credentialId,
    publicKey: data.publicKey,
    counter: data.counter ?? 0,
    deviceType: data.deviceType || null,
    backedUp: data.backedUp ?? false,
    name: data.name || null,
    transports: data.transports || [],
  }).returning();
  return passkey;
}

/** Update passkey usage (counter + lastUsedAt) */
export async function updatePasskeyUsage(id: string, counter: number) {
  const db = getDb();
  const [updated] = await db.update(passkeys).set({
    counter,
    lastUsedAt: new Date(),
  }).where(eq(passkeys.id, id)).returning();
  return updated;
}

/** Revoke (delete) a passkey */
export async function revokePasskey(id: string) {
  const db = getDb();
  await db.delete(passkeys).where(eq(passkeys.id, id));
}

/** Rename a passkey */
export async function renamePasskey(id: string, name: string) {
  const db = getDb();
  const [updated] = await db.update(passkeys).set({ name }).where(eq(passkeys.id, id)).returning();
  return updated;
}
