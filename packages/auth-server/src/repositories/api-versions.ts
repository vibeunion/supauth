// API version log repository (P1-10) — backed by SupaCloud Postgres
// Tracks version changes for contract enforcement

import { getApiVersionCommandStore, getApiVersionModels } from '../db/zenstack.js';
import type { VersionEntry as VersionWireEntry } from '../../../shared/src/server-operations.js';

export interface VersionEntry extends Omit<VersionWireEntry, 'createdAt'> {
  createdAt: Date;
}

/** Record a version change */
export async function recordVersionChange(data: Omit<VersionEntry, 'id' | 'createdAt'>) {
  return getApiVersionCommandStore().transaction(async ({ transaction }) => transaction.db.apiVersionLog.create({
    data: {
      version: data.version,
      changeType: data.changeType,
      path: data.path,
      method: data.method,
      description: data.description || null,
    },
  }));
}

/** Get all changes for a specific version */
export async function getVersionChanges(version: string) {
  return getApiVersionModels().apiVersionLog.findMany({
    where: { version },
    orderBy: { createdAt: 'asc' },
  });
}

/** Get all version entries */
export async function listVersions() {
  return getApiVersionModels().apiVersionLog.findMany({
    orderBy: { createdAt: 'asc' },
  });
}

/** Check if a given path+method has any breaking changes since a version */
export async function hasBreakingChange(path: string, method: string, sinceVersion: string): Promise<boolean> {
  const rows = await getApiVersionModels().apiVersionLog.findMany({
    where: { path, method, changeType: 'breaking' },
  });
  return rows.some(r =>
    r.method === method &&
    r.changeType === 'breaking' &&
    r.version > sinceVersion
  );
}
