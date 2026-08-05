// Connector catalog and tenant UX configuration repository.

import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { connectorFactories, tenantConfigs } from '../db/schema.js';
import { logAudit } from './audit.js';

export async function listConnectorFactories(category?: string) {
  const db = getDb();
  const query = db.select().from(connectorFactories);
  return category
    ? query.where(eq(connectorFactories.category, category)).orderBy(desc(connectorFactories.createdAt))
    : query.orderBy(desc(connectorFactories.createdAt));
}

export async function getConnectorFactory(factoryId: string) {
  const db = getDb();
  const rows = await db.select().from(connectorFactories)
    .where(eq(connectorFactories.factoryId, factoryId))
    .limit(1);
  return rows[0] || null;
}

export async function upsertConnectorFactory(factoryId: string, data: {
  name: string;
  protocol: string;
  category: string;
  configSchema?: Record<string, unknown>;
  enabled?: boolean;
}) {
  const db = getDb();
  const rows = await db.select().from(connectorFactories)
    .where(eq(connectorFactories.factoryId, factoryId))
    .limit(1);
  const values = {
    factoryId,
    name: data.name,
    protocol: data.protocol,
    category: data.category,
    configSchema: data.configSchema || {},
    enabled: data.enabled ?? true,
    updatedAt: new Date(),
  };
  const [factory] = rows[0]
    ? await db.update(connectorFactories).set(values)
      .where(eq(connectorFactories.id, rows[0].id)).returning()
    : await db.insert(connectorFactories).values(values).returning();
  await logAudit({
    eventType: 'connector.factory.updated',
    resourceType: 'connector_factory',
    resourceId: factoryId,
    details: { protocol: data.protocol, category: data.category, enabled: values.enabled },
  });
  return factory;
}

export async function listTenantConfigs(configType?: string) {
  const db = getDb();
  const query = db.select().from(tenantConfigs);
  return configType
    ? query.where(eq(tenantConfigs.configType, configType)).orderBy(desc(tenantConfigs.updatedAt))
    : query.orderBy(desc(tenantConfigs.updatedAt));
}

export async function getTenantConfig(configType: string, key: string) {
  const db = getDb();
  const rows = await db.select().from(tenantConfigs).where(and(
    eq(tenantConfigs.configType, configType),
    eq(tenantConfigs.key, key),
  )).limit(1);
  return rows[0] || null;
}

export async function upsertTenantConfig(configType: string, key: string, data: {
  value?: Record<string, unknown>;
  enabled?: boolean;
}) {
  const db = getDb();
  const existing = await getTenantConfig(configType, key);
  const values = {
    configType,
    key,
    value: data.value || {},
    enabled: data.enabled ?? true,
    updatedAt: new Date(),
  };
  const [config] = existing
    ? await db.update(tenantConfigs).set(values).where(eq(tenantConfigs.id, existing.id)).returning()
    : await db.insert(tenantConfigs).values(values).returning();
  await logAudit({
    eventType: `tenant_config.${configType}.updated`,
    resourceType: 'tenant_config',
    resourceId: `${configType}:${key}`,
    details: { enabled: values.enabled },
  });
  return config;
}

export interface TenantConfigRevision {
  id: string;
  updatedAt: Date;
  value: Record<string, unknown> | null;
  enabled: boolean;
}

interface TenantConfigWrite {
  value: Record<string, unknown>;
  enabled: boolean;
}

interface TenantConfigSwap {
  key: string;
  expected: TenantConfigRevision | null;
  write: TenantConfigWrite;
}

export interface TenantConfigPairSwapRequest {
  configType: string;
  first: TenantConfigSwap;
  second: TenantConfigSwap;
}

class TenantConfigPairConflict extends Error {}
type TenantConfigExecutor = Pick<ReturnType<typeof getDb>, 'insert' | 'update'>;

function tenantConfigValueMatches(expectedValue: Record<string, unknown> | null) {
  return expectedValue === null ? isNull(tenantConfigs.value) : eq(tenantConfigs.value, expectedValue);
}

async function swapTenantConfigRevision(
  executor: TenantConfigExecutor,
  configType: string,
  change: TenantConfigSwap,
) {
  const nextConfig = {
    configType,
    key: change.key,
    value: change.write.value,
    enabled: change.write.enabled,
    updatedAt: new Date(),
  };
  const [config] = change.expected
    ? await executor.update(tenantConfigs).set(nextConfig).where(and(
      eq(tenantConfigs.id, change.expected.id),
      eq(tenantConfigs.configType, configType),
      eq(tenantConfigs.key, change.key),
      eq(tenantConfigs.updatedAt, change.expected.updatedAt),
      tenantConfigValueMatches(change.expected.value),
      eq(tenantConfigs.enabled, change.expected.enabled),
    )).returning()
    : await executor.insert(tenantConfigs).values(nextConfig).onConflictDoNothing().returning();
  return config || null;
}

export async function compareAndSwapTenantConfig(
  configType: string,
  key: string,
  expected: TenantConfigRevision | null,
  write: TenantConfigWrite,
) {
  return swapTenantConfigRevision(getDb(), configType, { key, expected, write });
}

export async function compareAndSwapTenantConfigPair(request: TenantConfigPairSwapRequest) {
  const db = getDb();
  try {
    return await db.transaction(async (transaction) => {
      const first = await swapTenantConfigRevision(transaction, request.configType, request.first);
      if (!first) throw new TenantConfigPairConflict();
      const second = await swapTenantConfigRevision(transaction, request.configType, request.second);
      if (!second) throw new TenantConfigPairConflict();
      return { first, second };
    });
  } catch (error) {
    if (error instanceof TenantConfigPairConflict) return null;
    throw error;
  }
}

export async function deleteTenantConfigIfRevision(
  configType: string,
  key: string,
  expected: TenantConfigRevision,
) {
  const db = getDb();
  const [config] = await db.delete(tenantConfigs).where(and(
    eq(tenantConfigs.id, expected.id),
    eq(tenantConfigs.configType, configType),
    eq(tenantConfigs.key, key),
    eq(tenantConfigs.updatedAt, expected.updatedAt),
    tenantConfigValueMatches(expected.value),
    eq(tenantConfigs.enabled, expected.enabled),
  )).returning();
  return config || null;
}

export async function deleteTenantConfig(configType: string, key: string) {
  const db = getDb();
  const [config] = await db.delete(tenantConfigs).where(and(
    eq(tenantConfigs.configType, configType),
    eq(tenantConfigs.key, key),
  )).returning();
  if (config) {
    await logAudit({
      eventType: `tenant_config.${configType}.deleted`,
      resourceType: 'tenant_config',
      resourceId: `${configType}:${key}`,
    });
  }
  return config || null;
}
