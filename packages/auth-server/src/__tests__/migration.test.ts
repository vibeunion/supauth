import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOSTED_MIGRATIONS,
  MIGRATION_SQL,
  MIGRATION_V4_SQL,
  MIGRATION_V5_SQL,
  MIGRATION_V6_SQL,
  MIGRATION_V7_SQL,
  MIGRATION_V8_SQL,
  MIGRATION_V9_SQL,
  MIGRATION_V10_SQL,
} from '../db/migrate.js';

const __dirname2 = dirname(fileURLToPath(import.meta.url));
const migrateSrc = readFileSync(join(__dirname2, '../db/migrate.ts'), 'utf-8');

describe('Migration V4 — SQL structure', () => {
  it('defines MIGRATION_V4_SQL constant', () => {
    expect(migrateSrc).toContain('MIGRATION_V4_SQL');
  });

  it('does not create a local webhook delivery table', () => {
    expect(MIGRATION_V4_SQL).not.toContain('supaoauth.webhook_deliveries');
    expect(MIGRATION_V4_SQL).not.toContain('supaoauth.webhooks');
  });

  it('creates partial unique consent index', () => {
    expect(migrateSrc).toContain('uq_user_consents_active');
    expect(migrateSrc).toContain('WHERE revoked_at IS NULL');
  });

  it('adds secret_hash column to application_secrets', () => {
    expect(migrateSrc).toContain('ALTER TABLE supaoauth.application_secrets ADD COLUMN IF NOT EXISTS secret_hash');
  });

  it('wires V4 into runMigration', () => {
    expect(HOSTED_MIGRATIONS[1]).toEqual({
      name: 'supauth-overlay-hardening-v4',
      sql: MIGRATION_V4_SQL,
    });
  });
});

describe('Migration V5 — provisioning unique constraint', () => {
  it('defines MIGRATION_V5_SQL constant', () => {
    expect(migrateSrc).toContain('MIGRATION_V5_SQL');
  });

  it('deduplicates legacy provisioning rows before creating the unique index', () => {
    // Collapsing dupes is required so CREATE UNIQUE INDEX succeeds on tables
    // that accumulated duplicate (project_ref, step) rows pre-fix.
    expect(migrateSrc).toContain('DELETE FROM supaoauth.provisioning_records');
    expect(migrateSrc).toMatch(/keep\.updated_at.*keep\.id.*p\.updated_at.*p\.id/s);
  });

  it('creates unique index on (project_ref, step)', () => {
    expect(migrateSrc).toContain('uq_provisioning_records_project_step');
    expect(migrateSrc).toContain('ON supaoauth.provisioning_records (project_ref, step)');
  });

  it('wires V5 into runMigration after V4', () => {
    expect(HOSTED_MIGRATIONS[2]).toEqual({
      name: 'supauth-overlay-provisioning-v5',
      sql: MIGRATION_V5_SQL,
    });
  });
});

describe('Hosted migration chain', () => {
  it('grants the Function role only SupaOAuth overlay access', () => {
    expect(MIGRATION_V7_SQL).toContain('GRANT USAGE ON SCHEMA supaoauth');
    expect(MIGRATION_V7_SQL).toContain('ALL TABLES IN SCHEMA supaoauth');
    expect(MIGRATION_V7_SQL).not.toMatch(/GRANT\s+.*\s+ON\s+(?:ALL\s+TABLES\s+IN\s+SCHEMA\s+)?auth\b/i);
  });

  it('retires empty legacy webhook tables and blocks non-empty tables without CASCADE', () => {
    expect(MIGRATION_V9_SQL).toContain("REVOKE ALL PRIVILEGES ON TABLE supaoauth.webhook_deliveries FROM PUBLIC");
    expect(MIGRATION_V9_SQL).toContain("REVOKE ALL PRIVILEGES ON TABLE supaoauth.webhooks FROM PUBLIC");
    expect(MIGRATION_V9_SQL).not.toContain('RAISE EXCEPTION');
    expect(MIGRATION_V10_SQL).toContain('reason_code=legacy_webhook_data_present');
    expect(MIGRATION_V10_SQL).toContain('HINT =');
    expect(MIGRATION_V10_SQL).toContain('DROP TABLE IF EXISTS supaoauth.webhook_deliveries;');
    expect(MIGRATION_V10_SQL).toContain('DROP TABLE IF EXISTS supaoauth.webhooks;');
    expect(MIGRATION_V10_SQL.indexOf('DROP TABLE IF EXISTS supaoauth.webhook_deliveries;'))
      .toBeLessThan(MIGRATION_V10_SQL.indexOf('DROP TABLE IF EXISTS supaoauth.webhooks;'));
    expect(MIGRATION_V10_SQL).not.toMatch(/DROP TABLE[^;]+CASCADE/i);
  });

  it('keeps every forward-only migration in deterministic version order', () => {
    expect(HOSTED_MIGRATIONS).toEqual([
      { name: 'supauth-overlay-schema-v1', sql: MIGRATION_SQL },
      { name: 'supauth-overlay-hardening-v4', sql: MIGRATION_V4_SQL },
      { name: 'supauth-overlay-provisioning-v5', sql: MIGRATION_V5_SQL },
      { name: 'supauth-overlay-gotrue-authority-v6', sql: MIGRATION_V6_SQL },
      { name: 'supauth-overlay-function-access-v7', sql: MIGRATION_V7_SQL },
      { name: 'supauth-overlay-project-claims-v8', sql: MIGRATION_V8_SQL },
      { name: 'supauth-overlay-legacy-webhook-revoke-v9', sql: MIGRATION_V9_SQL },
      { name: 'supauth-overlay-legacy-webhook-retirement-v10', sql: MIGRATION_V10_SQL },
    ]);
    expect(migrateSrc).toContain('for (const migration of HOSTED_MIGRATIONS)');
    expect(migrateSrc).toContain('await sql.unsafe(migration.sql)');
  });

  it('reads only the current schema-v2 project projection and rejects legacy roots', () => {
    expect(MIGRATION_V8_SQL).toContain("current_database() ~ '^supa_.+$'");
    expect(MIGRATION_V8_SQL).toContain("namespace ->> 'schema_version' = '2'");
    expect(MIGRATION_V8_SQL).toContain("namespace -> 'projects' -> project_ref");
    expect(MIGRATION_V8_SQL).toContain("project_ref -> 'projection_unavailable'");
    expect(MIGRATION_V8_SQL).not.toContain("namespace -> 'permissions'");
    expect(MIGRATION_V8_SQL).toContain('supaoauth.current_project_claims()');
    expect(MIGRATION_V8_SQL).toContain('GRANT EXECUTE ON FUNCTION supaoauth.current_project_claims() TO authenticated');
  });
});
