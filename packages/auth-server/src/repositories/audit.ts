// Audit log repository — backed by SupaCloud Postgres

import { desc, eq, and, gte, lte } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { auditLogs } from '../db/schema.js';

export async function logAudit(event: {
  eventType: string;
  actorId?: string;
  actorType?: 'admin' | 'user' | 'system';
  resourceType: string;
  resourceId: string;
  details?: Record<string, unknown>;
}) {
  const db = getDb();
  const [entry] = await db.insert(auditLogs).values({
    eventType: event.eventType,
    actorId: event.actorId || null,
    actorType: event.actorType || 'system',
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    details: event.details || {},
  }).returning();
  return entry;
}

export async function queryAuditLogs(options?: {
  eventType?: string;
  resourceType?: string;
  resourceId?: string;
  actorId?: string;
  limit?: number;
  offset?: number;
  from?: Date;
  to?: Date;
}) {
  const db = getDb();
  const conditions = [];
  if (options?.eventType) conditions.push(eq(auditLogs.eventType, options.eventType));
  if (options?.resourceType) conditions.push(eq(auditLogs.resourceType, options.resourceType));
  if (options?.resourceId) conditions.push(eq(auditLogs.resourceId, options.resourceId));
  if (options?.actorId) conditions.push(eq(auditLogs.actorId, options.actorId));
  if (options?.from) conditions.push(gte(auditLogs.createdAt, options.from));
  if (options?.to) conditions.push(lte(auditLogs.createdAt, options.to));

  const query = conditions.length > 0
    ? db.select().from(auditLogs).where(and(...conditions)).orderBy(desc(auditLogs.createdAt))
    : db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt));

  const limit = options?.limit || 50;
  const offset = options?.offset || 0;
  return query.limit(limit).offset(offset);
}
