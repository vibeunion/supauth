import { eq } from 'drizzle-orm';
import { connectors } from '../db/schema.js';
import { getDb } from '../db/index.js';

export interface ConnectorConfigInput {
  providerId: string;
  runtimeKind?: string;
  name?: string;
  category?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

export function connectorConfigToResponse(row: typeof connectors.$inferSelect) {
  return {
    id: row.providerId,
    connector_record_id: row.id,
    provider_id: row.providerId,
    runtime_kind: row.runtimeKind,
    name: row.name,
    category: row.category,
    enabled: row.enabled,
    config: row.config || {},
    _meta: { id: row.id, created_at: row.createdAt, updated_at: row.updatedAt },
  };
}

export async function listConnectorConfigs() {
  const db = getDb();
  const rows = await db.select().from(connectors);
  return rows.map(connectorConfigToResponse);
}

export async function getConnectorConfig(providerId: string) {
  const db = getDb();
  const rows = await db.select().from(connectors)
    .where(eq(connectors.providerId, providerId))
    .limit(1);
  return rows[0] ? connectorConfigToResponse(rows[0]) : null;
}

export async function getConnectorConfigByRecordId(connectorRecordId: string) {
  const db = getDb();
  const rows = await db.select().from(connectors)
    .where(eq(connectors.id, connectorRecordId))
    .limit(1);
  return rows[0] ? connectorConfigToResponse(rows[0]) : null;
}

export async function listEnabledConnectorConfigs() {
  const db = getDb();
  const rows = await db.select().from(connectors)
    .where(eq(connectors.enabled, true));
  return rows.map(connectorConfigToResponse);
}

export async function upsertConnectorConfig(input: ConnectorConfigInput) {
  const db = getDb();
  const existingRows = await db.select().from(connectors)
    .where(eq(connectors.providerId, input.providerId))
    .limit(1);
  const existing = existingRows[0];
  const values: Partial<typeof connectors.$inferInsert> = {
    providerId: input.providerId,
    updatedAt: new Date(),
  };

  if (input.runtimeKind !== undefined) values.runtimeKind = input.runtimeKind;
  if (input.name !== undefined) values.name = input.name;
  if (input.category !== undefined) values.category = input.category;
  if (input.enabled !== undefined) values.enabled = input.enabled;
  if (input.config !== undefined) values.config = input.config;

  const [saved] = existing
    ? await db.update(connectors).set(values)
      .where(eq(connectors.id, existing.id))
      .returning()
    : await db.insert(connectors).values({
      providerId: input.providerId,
      runtimeKind: input.runtimeKind || 'builtin_oauth',
      name: input.name || input.providerId,
      category: input.category || 'social',
      enabled: input.enabled ?? false,
      config: input.config || {},
    }).returning();

  return connectorConfigToResponse(saved);
}
