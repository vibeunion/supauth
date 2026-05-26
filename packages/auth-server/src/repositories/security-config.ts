// Security configuration repository (P0-19) — backed by SupaCloud Postgres

import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { securityConfig } from '../db/schema.js';

export interface SecurityConfigRow {
  id: string;
  adminAuthMode: string;
  adminAllowedEmails: string[];
  adminAllowedDomains: string[];
  rateLimitRpm: number;
  rateLimitBurst: number;
  bruteForceProtection: boolean;
  maxLoginAttempts: number;
  lockoutDurationSec: number;
  secretRotationReminderDays: number;
  enforceHttps: boolean;
}

/** Get security config (singleton row) */
export async function getSecurityConfig(): Promise<SecurityConfigRow | null> {
  const db = getDb();
  const rows = await db.select().from(securityConfig).limit(1);
  return (rows[0] as SecurityConfigRow) || null;
}

/** Create default security config */
export async function createSecurityConfig(data?: Partial<SecurityConfigRow>) {
  const db = getDb();
  const [row] = await db.insert(securityConfig).values({
    adminAuthMode: data?.adminAuthMode || 'auto',
    adminAllowedEmails: data?.adminAllowedEmails || [],
    adminAllowedDomains: data?.adminAllowedDomains || [],
    rateLimitRpm: data?.rateLimitRpm ?? 300,
    rateLimitBurst: data?.rateLimitBurst ?? 50,
    bruteForceProtection: data?.bruteForceProtection ?? true,
    maxLoginAttempts: data?.maxLoginAttempts ?? 10,
    lockoutDurationSec: data?.lockoutDurationSec ?? 900,
    secretRotationReminderDays: data?.secretRotationReminderDays ?? 90,
    enforceHttps: data?.enforceHttps ?? true,
  }).returning();
  return row;
}

/** Update security config */
export async function updateSecurityConfig(data: Partial<SecurityConfigRow>) {
  const db = getDb();
  const current = await getSecurityConfig();
  if (!current) {
    return createSecurityConfig(data);
  }
  const [updated] = await db.update(securityConfig).set({
    ...data,
    updatedAt: new Date(),
  }).where(eq(securityConfig.id, current.id)).returning();
  return updated;
}

/** Check if ADMIN_TOKEN is allowed in current environment */
export function isTokenAuthAllowed(config: SecurityConfigRow | null): boolean {
  if (!config) return true; // no config row = dev mode
  if (config.adminAuthMode === 'sso') return false; // production SSO-only mode
  return true; // auto or token mode
}
