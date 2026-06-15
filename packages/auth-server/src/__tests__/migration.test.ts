import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname2 = dirname(fileURLToPath(import.meta.url));
const migrateSrc = readFileSync(join(__dirname2, '../db/migrate.ts'), 'utf-8');

describe('Migration V4 — SQL structure', () => {
  it('defines MIGRATION_V4_SQL constant', () => {
    expect(migrateSrc).toContain('MIGRATION_V4_SQL');
  });

  it('creates webhook_deliveries table', () => {
    expect(migrateSrc).toContain('CREATE TABLE IF NOT EXISTS supaoauth.webhook_deliveries');
    expect(migrateSrc).toContain('webhook_id UUID NOT NULL REFERENCES supaoauth.webhooks(id)');
    expect(migrateSrc).toContain('updated_at TIMESTAMPTZ NOT NULL DEFAULT now()');
  });

  it('creates partial unique consent index', () => {
    expect(migrateSrc).toContain('uq_user_consents_active');
    expect(migrateSrc).toContain('WHERE revoked_at IS NULL');
  });

  it('adds secret_hash column to application_secrets', () => {
    expect(migrateSrc).toContain('ALTER TABLE supaoauth.application_secrets ADD COLUMN IF NOT EXISTS secret_hash');
  });

  it('wires V4 into runMigration', () => {
    expect(migrateSrc).toContain('await sql.unsafe(MIGRATION_V4_SQL)');
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
    expect(migrateSrc).toContain('await sql.unsafe(MIGRATION_V5_SQL)');
  });
});
