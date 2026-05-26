#!/usr/bin/env bun
/**
 * Backup / restore drill helper (P0-21).
 *
 * This script produces a local metadata backup manifest and can replay the
 * SQL dump command against a target DATABASE_URL. It intentionally requires
 * explicit env vars for live restore to avoid accidental writes.
 */

import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const mode = args[0] || 'backup';
const backupDir = process.env.BACKUP_DIR || 'backups/latest';
const databaseUrl = process.env.DATABASE_URL || '';
const restoreDatabaseUrl = process.env.RESTORE_DATABASE_URL || '';

function run(command: string[], env: Record<string, string | undefined> = {}) {
  const result = Bun.spawnSync(command, {
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.exitCode !== 0) process.exit(result.exitCode);
}

function requireEnv(name: string, value: string) {
  if (!value) {
    console.error(`${name} is required`);
    process.exit(1);
  }
}

if (mode === 'backup') {
  requireEnv('DATABASE_URL', databaseUrl);
  mkdirSync(backupDir, { recursive: true });

  const manifest = {
    created_at: new Date().toISOString(),
    includes: [
      'supaoauth metadata schema',
      'migration state',
      'project config pointers',
      'OAuth/webhook secret inventory pointers',
      'storage object inventory pointers',
    ],
    restore_command: 'RESTORE_DATABASE_URL=... bun run scripts/backup-restore-drill.ts restore',
  };

  writeFileSync(`${backupDir}/manifest.json`, JSON.stringify(manifest, null, 2));
  run(['pg_dump', '--schema=supaoauth', '--no-owner', '--file', `${backupDir}/supaoauth.sql`, databaseUrl]);
  console.log(`Backup written to ${backupDir}`);
  process.exit(0);
}

if (mode === 'restore') {
  requireEnv('RESTORE_DATABASE_URL', restoreDatabaseUrl);
  run(['psql', restoreDatabaseUrl, '--file', `${backupDir}/supaoauth.sql`]);
  console.log(`Restore replayed from ${backupDir}`);
  process.exit(0);
}

console.error('Usage: bun run scripts/backup-restore-drill.ts [backup|restore]');
process.exit(1);
