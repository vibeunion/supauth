#!/usr/bin/env bun
/**
 * Release gate (P0-22).
 *
 * Runs local build/test gates, exports OpenAPI, optionally runs live fixtures,
 * and writes a release manifest with commit and artifact metadata.
 *
 * By default the gate FAILS when the worktree is dirty or live fixtures are
 * skipped, to prevent shipping unreviewed or under-verified releases.
 * Set ALLOW_DIRTY_RELEASE=1 to bypass the dirty check (e.g. local builds).
 * Set ALLOW_SKIP_LIVE_GATE=1 to allow passing without live fixtures
 * (intended only for non-cutover / CI smoke runs).
 */

import { mkdirSync, writeFileSync } from 'node:fs';

const releaseId = process.env.RELEASE_ID || `release-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const artifactDir = process.env.ARTIFACT_DIR || `artifacts/${releaseId}`;
const runLive = process.env.RUN_LIVE_RELEASE_GATE === '1';
const allowDirty = process.env.ALLOW_DIRTY_RELEASE === '1';
const allowSkipLive = process.env.ALLOW_SKIP_LIVE_GATE === '1';

function run(command: string[], options: { env?: Record<string, string | undefined> } = {}) {
  const result = Bun.spawnSync(command, {
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, ...options.env },
  });
  if (result.exitCode !== 0) process.exit(result.exitCode);
}

function output(command: string[]): string {
  const result = Bun.spawnSync(command, { stdout: 'pipe', stderr: 'inherit' });
  if (result.exitCode !== 0) process.exit(result.exitCode);
  return new TextDecoder().decode(result.stdout).trim();
}

// Snapshot worktree state BEFORE we create any release artifact, otherwise the
// manifest this script writes would make the tree look dirty even on a clean run.
const commit = output(['git', 'rev-parse', 'HEAD']);
const status = output(['git', 'status', '--short']);
const isDirty = status.length > 0;

// Refuse to release from a dirty worktree unless explicitly bypassed.
if (isDirty && !allowDirty) {
  console.error('Release gate FAILED: worktree is dirty.');
  console.error('Uncommitted changes:');
  console.error(status);
  console.error('');
  console.error('Commit or stash your changes, or set ALLOW_DIRTY_RELEASE=1 to override.');
  process.exit(1);
}

// Refuse to release without live fixtures unless explicitly bypassed. The
// comment at the top of this file promises this default; honor it so a
// "passed" manifest is never produced from an under-verified tree.
if (!runLive && !allowSkipLive) {
  console.error('Release gate FAILED: live fixture gate was not run.');
  console.error('Set RUN_LIVE_RELEASE_GATE=1 for pre-cutover verification, or');
  console.error('ALLOW_SKIP_LIVE_GATE=1 for non-cutover / CI smoke runs.');
  process.exit(1);
}

// Now it is safe to produce artifacts — dirty check already passed above.
mkdirSync(artifactDir, { recursive: true });

run(['bunx', 'tsc', '--noEmit']);
run(['bun', 'test']);
run(['bun', 'run', 'check']);
run(['bun', 'run', 'scripts/export-openapi.ts', `${artifactDir}/openapi.json`]);

if (runLive) {
  run(['bun', 'test', 'tests/integration/supabase-compat/'], {
    env: {
      RUN_SUPABASE_RUNTIME_COMPAT: '1',
      RUN_SUPABASE_OAUTH21_COMPAT: process.env.RUN_SUPABASE_OAUTH21_COMPAT,
    },
  });
}

const openapiHash = output(['shasum', '-a', '256', `${artifactDir}/openapi.json`]);

writeFileSync(`${artifactDir}/release-manifest.json`, JSON.stringify({
  release_id: releaseId,
  commit,
  openapi_hash: openapiHash.split(/\s+/)[0],
  dirty: isDirty,
  live_gate: runLive,
  created_at: new Date().toISOString(),
}, null, 2));

console.log(`Release gate passed: ${artifactDir}`);
