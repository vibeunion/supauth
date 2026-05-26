// Connector catalog and tenant UX configuration repository.

import { and, desc, eq } from 'drizzle-orm';
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
