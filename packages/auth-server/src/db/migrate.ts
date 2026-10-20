// Migration script for SupAuth overlay tables in a SupaCloud project.
// SupaCloud owns identity management tables; this migration intentionally does
// not create duplicate Organizations/RBAC/Users/Audit/Webhooks source tables.

import postgres from 'postgres';
import { HOSTED_MIGRATIONS } from './migrations/index.js';

export * from './migrations/index.js';

export async function runMigration(databaseUrl?: string) {
  const url = databaseUrl || process.env["SUPACLOUD_DATABASE_URL"] || process.env["DATABASE_URL"] || '';
  if (!url) throw new Error('SUPACLOUD_DATABASE_URL or DATABASE_URL is required for migration');
  const sql = postgres(url, { max: 1 });

  try {
    for (const migration of HOSTED_MIGRATIONS) {
      await sql.unsafe(migration.sql);
    }
    console.log('SupaOAuth overlay schema migration completed');
  } catch (e) {
    console.error(`Migration failed: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  console.error('Direct DB migration is removed. Run `bun run install:supacloud` so SupaCloud Management API applies hosted migrations.');
  process.exit(1);
}
