// Database connection — uses SupaCloud's Postgres instance
// SupaOAuth metadata lives in the `supaoauth` schema, separate from `auth` (GoTrue)

import { SQL } from 'bun';
import { drizzle, type BunSQLDatabase } from 'drizzle-orm/bun-sql';
import * as schema from './schema.js';
import { runtimeEnv } from '../config/platform-env.js';

export interface DbConfig {
  url: string;
}

function getConnectionConfig(): DbConfig {
  const url = runtimeEnv('SUPACLOUD_DATABASE_URL') || runtimeEnv('DATABASE_URL') || '';
  if (!url) {
    throw new Error('DATABASE_URL or SUPACLOUD_DATABASE_URL is required for SupaOAuth metadata DB');
  }
  return { url };
}

let _db: BunSQLDatabase<typeof schema> | null = null;
let _sql: SQL | null = null;

export function getSql() {
  if (_sql) return _sql;
  const { url } = getConnectionConfig();

  _sql = new SQL(url, {
    max: 10,
    idleTimeout: 20,
    connectionTimeout: 2,
  });
  return _sql;
}

export function getDb() {
  if (_db) return _db;
  _db = drizzle(getSql(), { schema });
  return _db;
}

export async function closeDb() {
  const sql = _sql;
  _sql = null;
  _db = null;
  if (sql) {
    await sql.close();
  }
}

// Re-export schema for convenience
export { schema };
export type Database = BunSQLDatabase<typeof schema>;
