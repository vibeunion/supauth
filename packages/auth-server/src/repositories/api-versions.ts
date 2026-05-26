// API version log repository (P1-10) — backed by SupaCloud Postgres
// Tracks version changes for contract enforcement

import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { apiVersionLog } from '../db/schema.js';

export interface VersionEntry {
  id: string;
  version: string;
  changeType: 'added' | 'deprecated' | 'breaking' | 'removed';
  path: string;
  method: string;
  description: string | null;
  createdAt: Date;
}

/** Record a version change */
export async function recordVersionChange(data: Omit<VersionEntry, 'id' | 'createdAt'>) {
  const db = getDb();
  const [entry] = await db.insert(apiVersionLog).values({
    version: data.version,
    changeType: data.changeType,
    path: data.path,
    method: data.method,
    description: data.description || null,
  }).returning();
  return entry;
}

/** Get all changes for a specific version */
export async function getVersionChanges(version: string) {
  const db = getDb();
  return db.select().from(apiVersionLog)
    .where(eq(apiVersionLog.version, version))
    .orderBy(apiVersionLog.createdAt);
}

/** Get all version entries */
export async function listVersions() {
  const db = getDb();
  return db.select().from(apiVersionLog).orderBy(apiVersionLog.createdAt);
}

/** Check if a given path+method has any breaking changes since a version */
export async function hasBreakingChange(path: string, method: string, sinceVersion: string): Promise<boolean> {
  const db = getDb();
  const rows = await db.select().from(apiVersionLog)
    .where(eq(apiVersionLog.path, path));
  return rows.some(r =>
    r.method === method &&
    r.changeType === 'breaking' &&
    r.version > sinceVersion
  );
}
