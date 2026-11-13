import { createZenStackDatabase } from '@supacloud/db/zenstack';
import { getSql } from './index.js';
import { schema } from '../../zenstack/generated/schema.js';

const API_VERSION_ADMIN_IDENTITY = {
  userId: 'supauth-api-version-admin',
  canManage: true,
} as const;

let database: ReturnType<typeof createZenStackDatabase<typeof schema>> | null = null;

function getDatabase() {
  database ??= createZenStackDatabase(schema, getSql(), {});
  return database;
}

export function getApiVersionModels() {
  return getDatabase().forIdentity(API_VERSION_ADMIN_IDENTITY).models;
}

export async function closeZenStackDatabase(): Promise<void> {
  if (!database) return;
  await database.dispose();
  database = null;
}
