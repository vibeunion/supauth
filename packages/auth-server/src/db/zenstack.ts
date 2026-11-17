import { createZenStackDatabase } from '@supacloud/db/zenstack';
import { getSql } from './index.js';
import { schema } from '../../zenstack/generated/schema.js';

const API_VERSION_ADMIN_IDENTITY = {
  userId: 'supauth-api-version-admin',
  canManage: true,
} as const;

let database: ReturnType<typeof createZenStackDatabase<typeof schema>> | null = null;
type ApiVersionScope = ReturnType<ReturnType<typeof createZenStackDatabase<typeof schema>>['forIdentity']>;

function getDatabase() {
  database ??= createZenStackDatabase(schema, getSql(), {});
  return database;
}

function getApiVersionScope() {
  return getDatabase().forIdentity(API_VERSION_ADMIN_IDENTITY);
}

export function getApiVersionModels() {
  return getApiVersionScope().models;
}

export function getApiVersionCommandStore(): ApiVersionScope['commandStore'] {
  return getApiVersionScope().commandStore;
}

export async function closeZenStackDatabase(): Promise<void> {
  if (!database) return;
  await database.dispose();
  database = null;
}
