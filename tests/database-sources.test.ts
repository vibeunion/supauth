import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { HOSTED_MIGRATION_CATALOG } from '../packages/auth-server/src/db/migrations/catalog.js';
import { HOSTED_MIGRATIONS } from '../packages/auth-server/src/db/migrations/index.js';

const migrationsDir = join(
  import.meta.dir,
  '..',
  'packages',
  'auth-server',
  'src',
  'db',
  'migrations-sql',
);

describe('database source contracts', () => {
  test('SQL migration snapshots stay identical to the hosted migration ledger', () => {
    expect(HOSTED_MIGRATIONS).toHaveLength(HOSTED_MIGRATION_CATALOG.length);

    for (const [index, migration] of HOSTED_MIGRATIONS.entries()) {
      const catalog = HOSTED_MIGRATION_CATALOG[index];
      expect(catalog).toBeDefined();
      if (catalog === undefined) continue;
      const version = catalog.version.padStart(4, '0');
      const file = join(migrationsDir, `${version}_${migration.name}.sql`);
      expect(readFileSync(file, 'utf8')).toBe(migration.sql);
    }
  });
});