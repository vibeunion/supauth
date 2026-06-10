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
const runSupabaseRuntimeCompat = process.env.RUN_SUPABASE_RUNTIME_COMPAT === '1';
const runSupabaseOauth21Compat = process.env.RUN_SUPABASE_OAUTH21_COMPAT === '1';

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
run(['bun', 'run', 'build'], { env: { SUPAUTH_SUPACLOUD_ARTIFACT_DIR: artifactDir } });
run(['bun', 'run', 'scripts/verify-supacloud-app-artifact.ts', '--artifact-dir', artifactDir]);

const supacloudAppManifestHash = output(['shasum', '-a', '256', `${artifactDir}/supacloud-app-manifest.json`]).split(/\s+/)[0];
let supacloudInstalledAppVerification: string | undefined;

if (runLive) {
  const installedBaseUrl = process.env.SUPAUTH_INSTALLED_BASE_URL?.replace(/\/+$/, '');
  const installedRuntimeUrl = process.env.SUPAUTH_INSTALLED_RUNTIME_URL?.replace(/\/+$/, '');
  if (!installedBaseUrl || !installedRuntimeUrl) {
    console.error('RUN_LIVE_RELEASE_GATE=1 requires SUPAUTH_INSTALLED_BASE_URL and SUPAUTH_INSTALLED_RUNTIME_URL');
    process.exit(1);
  }

  if (runSupabaseRuntimeCompat) {
    run([
      'bun',
      'test',
      'tests/integration/supabase-compat/supabase-js.test.ts',
      'tests/integration/supabase-compat/supacloud-contract.test.ts',
    ], {
      env: {
        RUN_SUPABASE_RUNTIME_COMPAT: '1',
        OAUTH_RUNTIME_URL: process.env.OAUTH_RUNTIME_URL || installedRuntimeUrl,
        MANAGEMENT_URL: process.env.MANAGEMENT_URL || `${installedBaseUrl}/api`,
      },
    });
  }

  if (runSupabaseOauth21Compat) {
    run(['bun', 'test', 'tests/integration/supabase-compat/oauth21.test.ts'], {
      env: {
        RUN_SUPABASE_OAUTH21_COMPAT: '1',
        OAUTH_RUNTIME_URL: process.env.OAUTH_RUNTIME_URL || installedRuntimeUrl,
      },
    });
  }

  supacloudInstalledAppVerification = `${artifactDir}/supacloud-installed-app-verification.json`;
  run([
    'bun',
    'run',
    'scripts/verify-supacloud-installed-app.ts',
    '--artifact-dir',
    artifactDir,
    '--expected-manifest-hash',
    supacloudAppManifestHash,
    '--output',
    supacloudInstalledAppVerification,
  ]);
}

const commit = output(['git', 'rev-parse', 'HEAD']);
const status = output(['git', 'status', '--short']);
const openapiHash = output(['shasum', '-a', '256', `${artifactDir}/openapi.json`]);

writeFileSync(`${artifactDir}/release-manifest.json`, JSON.stringify({
  release_id: releaseId,
  commit,
  openapi_hash: openapiHash.split(/\s+/)[0],
  supacloud_app_manifest: `${artifactDir}/supacloud-app-manifest.json`,
  supacloud_app_manifest_hash: supacloudAppManifestHash,
  supacloud_installed_app_verification: supacloudInstalledAppVerification,
  dirty: status.length > 0,
  live_gate: runLive,
  created_at: new Date().toISOString(),
}, null, 2));

console.log(`Release gate passed: ${artifactDir}`);
