// Account provisioning and claiming repository.
// GoTrue keeps auth.users.id as the identity primary key; external_id is the
// tenant-owned anchor used for imports, sync, and self-service account claims.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { accountProvisioningRecords } from '../db/schema.js';
import { logAudit } from './audit.js';

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
const ENCRYPTION_VERSION = 'v1';

export interface AccountProvisioningImportRecord {
  external_id: string;
  external_type?: string;
  display_name: string;
  email: string;
  user_id?: string | null;
  initial_password?: string;
  source_status?: string;
  profile?: Record<string, unknown>;
  import_batch?: string | null;
  metadata?: Record<string, unknown>;
  generate_initial_password?: boolean;
}

export interface AccountClaimInput {
  externalId: string;
  displayName: string;
  externalType?: string;
  ip?: string;
  userAgent?: string;
}

export type AccountClaimResult =
  | { status: 'claimed'; email: string; initialPassword: string }
  | { status: 'already_claimed'; email: string; claimedAt: Date | null }
  | { status: 'password_unavailable'; email: string }
  | { status: 'not_found' };

export function normalizeDisplayName(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

export function normalizeExternalId(value: string): string {
  return value.normalize('NFKC').trim();
}

function claimSecret(): string {
  const secret = process.env.ACCOUNT_CLAIM_SECRET
    || process.env.ADMIN_TOKEN
    || process.env.SUPACLOUD_MASTER_TOKEN
    || '';
  if (secret.length < 16) {
    throw new Error('ACCOUNT_CLAIM_SECRET, ADMIN_TOKEN, or SUPACLOUD_MASTER_TOKEN is required for account claim password encryption');
  }
  return secret;
}

function keyFromSecret(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

export function encryptInitialPassword(password: string, secret = claimSecret()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromSecret(secret), iv);
  const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENCRYPTION_VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
}

export function decryptInitialPassword(payload: string, secret = claimSecret()): string {
  const [version, ivRaw, tagRaw, encryptedRaw] = payload.split(':');
  if (version !== ENCRYPTION_VERSION || !ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error('Unsupported account claim password payload');
  }
  const decipher = createDecipheriv('aes-256-gcm', keyFromSecret(secret), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function generateInitialPassword(length = 12): string {
  const bytes = randomBytes(length);
  let password = '';
  for (const byte of bytes) password += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
  return password;
}

export async function upsertAccountProvisioningRecord(record: AccountProvisioningImportRecord) {
  const db = getDb();
  const externalId = normalizeExternalId(record.external_id);
  const externalType = record.external_type || 'generic';
  const normalizedDisplayName = normalizeDisplayName(record.display_name);
  const sourceStatus = record.source_status || 'active';

  if (!externalId) throw new Error('external_id is required');
  if (!normalizedDisplayName) throw new Error('display_name is required');
  if (!record.email) throw new Error('email is required');

  const existingRows = await db.select().from(accountProvisioningRecords)
    .where(and(
      eq(accountProvisioningRecords.externalId, externalId),
      eq(accountProvisioningRecords.externalType, externalType),
    ))
    .limit(1);
  const existing = existingRows[0];
  const shouldGeneratePassword = record.generate_initial_password !== false;
  const initialPassword = record.initial_password
    || (shouldGeneratePassword && !existing?.initialPasswordEncrypted && !existing?.initialPasswordClaimed ? generateInitialPassword() : null);
  const encryptedPassword = initialPassword ? encryptInitialPassword(initialPassword) : existing?.initialPasswordEncrypted || null;

  const values = {
    externalId,
    externalType,
    displayName: record.display_name.trim(),
    normalizedDisplayName,
    email: record.email.trim().toLowerCase(),
    userId: record.user_id || existing?.userId || null,
    initialPasswordEncrypted: encryptedPassword,
    sourceStatus,
    profile: record.profile || {},
    importBatch: record.import_batch || null,
    metadata: record.metadata || {},
    updatedAt: new Date(),
  };

  const [saved] = existing
    ? await db.update(accountProvisioningRecords).set(values)
      .where(eq(accountProvisioningRecords.id, existing.id))
      .returning()
    : await db.insert(accountProvisioningRecords).values({
      ...values,
      initialPasswordClaimed: false,
      claimCount: 0,
    }).returning();

  return { record: saved, initialPassword };
}

export async function findAccountProvisioningRecord(input: {
  externalId: string;
  displayName: string;
  externalType?: string;
}) {
  const db = getDb();
  const rows = await db.select().from(accountProvisioningRecords)
    .where(and(
      eq(accountProvisioningRecords.externalId, normalizeExternalId(input.externalId)),
      eq(accountProvisioningRecords.externalType, input.externalType || 'generic'),
      eq(accountProvisioningRecords.normalizedDisplayName, normalizeDisplayName(input.displayName)),
    ))
    .limit(1);
  return rows[0] || null;
}

export async function claimAccount(input: AccountClaimInput): Promise<AccountClaimResult> {
  const record = await findAccountProvisioningRecord(input);
  if (!record || !['active', '正常'].includes(record.sourceStatus)) return { status: 'not_found' };
  if (record.initialPasswordClaimed) {
    return { status: 'already_claimed', email: record.email, claimedAt: record.claimedAt };
  }
  if (!record.initialPasswordEncrypted) {
    return { status: 'password_unavailable', email: record.email };
  }

  const initialPassword = decryptInitialPassword(record.initialPasswordEncrypted);
  const db = getDb();
  await db.update(accountProvisioningRecords).set({
    initialPasswordClaimed: true,
    initialPasswordEncrypted: null,
    claimedAt: new Date(),
    claimCount: sql`${accountProvisioningRecords.claimCount} + 1`,
    updatedAt: new Date(),
  }).where(eq(accountProvisioningRecords.id, record.id));

  await logAudit({
    eventType: 'account_provisioning.claimed',
    actorType: 'user',
    resourceType: 'account_provisioning_record',
    resourceId: `${record.externalType}:${record.externalId}`,
    details: {
      email: record.email,
      ip: input.ip || null,
      user_agent: input.userAgent || null,
    },
  });

  return { status: 'claimed', email: record.email, initialPassword };
}

export async function listAccountProvisioningRecords(limit = 100, offset = 0) {
  const db = getDb();
  return db.select({
    id: accountProvisioningRecords.id,
    externalId: accountProvisioningRecords.externalId,
    externalType: accountProvisioningRecords.externalType,
    displayName: accountProvisioningRecords.displayName,
    email: accountProvisioningRecords.email,
    userId: accountProvisioningRecords.userId,
    initialPasswordClaimed: accountProvisioningRecords.initialPasswordClaimed,
    claimedAt: accountProvisioningRecords.claimedAt,
    sourceStatus: accountProvisioningRecords.sourceStatus,
    profile: accountProvisioningRecords.profile,
    importBatch: accountProvisioningRecords.importBatch,
    createdAt: accountProvisioningRecords.createdAt,
    updatedAt: accountProvisioningRecords.updatedAt,
  }).from(accountProvisioningRecords).limit(limit).offset(offset);
}
