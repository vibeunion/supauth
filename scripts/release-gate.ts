#!/usr/bin/env bun
/**
 * Release gate (P0-22).
 *
 * Runs local build/test gates, exports OpenAPI, optionally runs live fixtures,
 * and writes a release manifest with commit and artifact metadata.
 */

import { mkdirSync, writeFileSync } from 'node:fs';

const releaseId = process.env.RELEASE_ID || `release-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const artifactDir = process.env.ARTIFACT_DIR || `artifacts/${releaseId}`;
const runLive = process.env.RUN_LIVE_RELEASE_GATE === '1';

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

const commit = output(['git', 'rev-parse', 'HEAD']);
const status = output(['git', 'status', '--short']);
const openapiHash = output(['shasum', '-a', '256', `${artifactDir}/openapi.json`]);

writeFileSync(`${artifactDir}/release-manifest.json`, JSON.stringify({
  release_id: releaseId,
  commit,
  openapi_hash: openapiHash.split(/\s+/)[0],
  dirty: status.length > 0,
  live_gate: runLive,
  created_at: new Date().toISOString(),
}, null, 2));

console.log(`Release gate passed: ${artifactDir}`);
