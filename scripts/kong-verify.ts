#!/usr/bin/env bun
/**
 * Compatibility entrypoint for the old route verifier.
 *
 * SupAuth is no longer verified by pointing at a raw Kong host. SupaCloud owns
 * gateway routing, so this wrapper delegates to the installed app verifier.
 */

import { verifySupacloudInstalledApp } from './verify-supacloud-installed-app.js';

function option(name: string) {
  const index = Bun.argv.indexOf(`--${name}`);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}

const legacyHost = option('host');
const legacyDomain = option('domain');

if (legacyHost || legacyDomain) {
  console.warn('scripts/kong-verify.ts no longer verifies a raw gateway host. Use --base-url and --runtime-url for the installed SupaCloud app.');
}

const result = await verifySupacloudInstalledApp({
  artifactDir: option('artifact-dir'),
  manifestPath: option('manifest'),
  baseUrl: option('base-url') || process.env.SUPAUTH_INSTALLED_BASE_URL,
  runtimeUrl: option('runtime-url') || process.env.SUPAUTH_INSTALLED_RUNTIME_URL,
  expectedManifestHash: option('expected-manifest-hash') || process.env.SUPAUTH_EXPECTED_MANIFEST_HASH,
});

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
