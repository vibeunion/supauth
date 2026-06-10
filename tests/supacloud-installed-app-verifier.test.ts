import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSupacloudAppManifest } from '../scripts/supacloud-app-contract.js';
import { verifySupacloudInstalledApp } from '../scripts/verify-supacloud-installed-app.js';

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'supauth-installed-app-'));
  const artifactDir = 'artifact';
  const adminDir = 'admin-build';
  const functionBundle = 'function/supacloud-function.js';
  const openapiPath = 'artifact/openapi.json';

  mkdirSync(join(root, 'function'), { recursive: true });
  mkdirSync(join(root, adminDir), { recursive: true });
  mkdirSync(join(root, artifactDir), { recursive: true });

  writeFileSync(join(root, functionBundle), 'export default { fetch() {} };');
  writeFileSync(join(root, adminDir, 'index.html'), '<!doctype html>');
  writeFileSync(join(root, adminDir, 'authorize.html'), '<!doctype html>');
  writeFileSync(join(root, adminDir, 'claim.html'), '<!doctype html>');
  writeFileSync(join(root, openapiPath), JSON.stringify({ openapi: '3.0.3', paths: {} }));

  const manifest = createSupacloudAppManifest({
    functionBundle,
    adminStaticDir: adminDir,
    openapiPath,
  });
  writeFileSync(join(root, artifactDir, 'supacloud-app-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  return { root, artifactDir };
}

function mockFetch(overrides: Record<string, number> = {}) {
  const defaultStatuses: Record<string, number> = {
    '/api/v1/health': 200,
    '/v1/public/sign-in-experience/resolve': 200,
    '/login.html': 200,
    '/claim': 200,
    '/claim.html': 200,
    '/favicon.ico': 200,
    '/oauth/authorize': 400,
    '/auth/v1/health': 200,
    '/rest/v1/': 401,
    '/storage/v1/bucket': 401,
    '/realtime/v1/websocket': 400,
    '/functions/v1/': 404,
    ...overrides,
  };

  return async (input: string | URL) => {
    const url = new URL(String(input));
    const status = defaultStatuses[url.pathname] ?? 404;
    return new Response(status === 200 ? 'ok' : 'probe', { status });
  };
}

describe('SupaCloud installed app verifier', () => {
  it('accepts an installed SupAuth app with Function, Pages, and preserved runtime routes', async () => {
    const { root, artifactDir } = createFixture();

    const result = await verifySupacloudInstalledApp({
      root,
      artifactDir,
      baseUrl: 'https://auth.example.test',
      runtimeUrl: 'https://project.example.test',
      fetchImpl: mockFetch(),
    });

    expect(result.ok).toBe(true);
    expect(result.offlineArtifactOk).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.probes.every((probe) => probe.ok)).toBe(true);
  });

  it('fails instead of pretending live verification passed when deployed URLs are missing', async () => {
    const { root, artifactDir } = createFixture();

    const result = await verifySupacloudInstalledApp({
      root,
      artifactDir,
      fetchImpl: mockFetch(),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Missing deployed SupAuth base URL: set --base-url or SUPAUTH_INSTALLED_BASE_URL');
    expect(result.errors).toContain('Missing SupaCloud runtime URL: set --runtime-url or SUPAUTH_INSTALLED_RUNTIME_URL');
  });

  it('rejects a deployed app when SupAuth Function routes are missing', async () => {
    const { root, artifactDir } = createFixture();

    const result = await verifySupacloudInstalledApp({
      root,
      artifactDir,
      baseUrl: 'https://auth.example.test',
      runtimeUrl: 'https://project.example.test',
      fetchImpl: mockFetch({ '/api/v1/health': 404 }),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('supauth_health_api_strip_prefix failed: expected HTTP 200, got HTTP 404');
  });

  it('rejects a manifest hash mismatch', async () => {
    const { root, artifactDir } = createFixture();

    const result = await verifySupacloudInstalledApp({
      root,
      artifactDir,
      baseUrl: 'https://auth.example.test',
      runtimeUrl: 'https://project.example.test',
      expectedManifestHash: 'not-the-current-manifest',
      fetchImpl: mockFetch(),
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('Installed verifier manifest hash mismatch');
  });
});
