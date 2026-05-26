// Enterprise SSO configuration repository (P1-9) — backed by SupaCloud Postgres

import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { enterpriseSSOConfig, connectors } from '../db/schema.js';

export interface EnterpriseSSOConfigRow {
  id: string;
  connectorId: string;
  domains: string[];
  ssoProtocol: string;
  jitProvisioning: boolean;
  orgMembershipMapping: Record<string, string>;
  roleMapping: Record<string, string>;
}

/** List all enterprise SSO configs */
export async function listEnterpriseSSOConfigs() {
  const db = getDb();
  return db.select().from(enterpriseSSOConfig)
    .orderBy(enterpriseSSOConfig.createdAt);
}

/** Get enterprise SSO config by connector ID */
export async function getEnterpriseSSOConfig(connectorId: string) {
  const db = getDb();
  const rows = await db.select().from(enterpriseSSOConfig)
    .where(eq(enterpriseSSOConfig.connectorId, connectorId)).limit(1);
  return rows[0] || null;
}

/** Create enterprise SSO config */
export async function createEnterpriseSSOConfig(data: {
  connectorId: string;
  domains: string[];
  ssoProtocol?: string;
  jitProvisioning?: boolean;
  orgMembershipMapping?: Record<string, string>;
  roleMapping?: Record<string, string>;
}) {
  const db = getDb();
  const [config] = await db.insert(enterpriseSSOConfig).values({
    connectorId: data.connectorId,
    domains: data.domains,
    ssoProtocol: data.ssoProtocol || 'oidc',
    jitProvisioning: data.jitProvisioning ?? false,
    orgMembershipMapping: data.orgMembershipMapping || {},
    roleMapping: data.roleMapping || {},
  }).returning();
  return config;
}

/** Update enterprise SSO config */
export async function updateEnterpriseSSOConfig(id: string, data: {
  domains?: string[];
  ssoProtocol?: string;
  jitProvisioning?: boolean;
  orgMembershipMapping?: Record<string, string>;
  roleMapping?: Record<string, string>;
}) {
  const db = getDb();
  const [updated] = await db.update(enterpriseSSOConfig).set({
    ...data,
    updatedAt: new Date(),
  }).where(eq(enterpriseSSOConfig.id, id)).returning();
  return updated;
}

/** Delete enterprise SSO config */
export async function deleteEnterpriseSSOConfig(id: string) {
  const db = getDb();
  await db.delete(enterpriseSSOConfig).where(eq(enterpriseSSOConfig.id, id));
}

/** Find SSO config by email domain — used for domain discovery routing */
export async function findSSOConfigByDomain(domain: string) {
  const db = getDb();
  const allConfigs = await db.select().from(enterpriseSSOConfig);
  return allConfigs.find(config => {
    const domains = config.domains as string[];
    return domains.map(d => d.toLowerCase()).includes(domain.toLowerCase());
  }) || null;
}
