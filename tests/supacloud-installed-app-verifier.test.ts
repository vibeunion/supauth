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
  writeFileSync(join(root, adminDir, 'change-password.html'), '<!doctype html>');
  writeFileSync(join(root, adminDir, 'account.html'), '<!doctype html>');
  writeFileSync(join(root, openapiPath), JSON.stringify({ openapi: '3.0.3', paths: {} }));

  const manifest = createSupacloudAppManifest({
    functionBundle,
    adminStaticDir: adminDir,
    openapiPath,
  });
  writeFileSync(join(root, artifactDir, 'supacloud-app-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  return { root, artifactDir };
}

interface MockFetchRequest {
  url: URL;
  init?: RequestInit;
}

function mockFetch(overrides: Record<string, number> = {}, ssoAuthorizeLocation?: string, requestLog: MockFetchRequest[] = []) {
  const defaultStatuses: Record<string, number> = {
    '/api/v1/health': 200,
    '/api/v1/capabilities': 401,
    '/v1/auth-config': 401,
    '/v1/public/sign-in-experience/resolve': 200,
    '/admin/security': 200,
    '/login': 200,
    '/login.html': 200,
    '/authorize.html': 200,
    '/account': 200,
    '/account.html': 200,
    '/account/password': 200,
    '/claim': 200,
    '/claim.html': 200,
    '/favicon.ico': 200,
    '/oauth/authorize': 400,
    '/auth/v1/oauth/authorize': 302,
    '/auth/v1/health': 200,
    '/auth/v1/.well-known/openid-configuration': 200,
    '/auth/v1/.well-known/jwks.json': 200,
    '/rest/v1/': 401,
    '/storage/v1/bucket': 401,
    '/realtime/v1/websocket': 400,
    '/functions/v1/': 400,
    '/functions/v1/supauth/api/v1/health': 200,
    ...overrides,
  };

  return async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requestLog.push({ url, init });
    if (url.pathname === '/oauth/sso/authorize' && url.searchParams.has('client_id')) {
      const location = overrides['/oauth/sso/authorize'] === 302
        ? ssoAuthorizeLocation || 'https://auth.example.test/auth/v1/oauth/authorize?client_id=app_123'
        : 'https://project.example.test/auth/v1/oauth/authorize?client_id=app_123';
      return new Response('redirect', { status: 302, headers: { location } });
    }
    const status = defaultStatuses[url.pathname] ?? 404;
    return new Response(status === 200 ? 'ok' : 'probe', { status });
  };
}

describe('SupaCloud installed app verifier', () => {
  it('accepts an installed SupAuth app with Function, Pages, and preserved runtime routes', async () => {
    const { root, artifactDir } = createFixture();
    const requestLog: MockFetchRequest[] = [];

    const result = await verifySupacloudInstalledApp({
      root,
      artifactDir,
      baseUrl: 'https://auth.example.test',
      runtimeUrl: 'https://project.example.test',
      fetchImpl: mockFetch({}, undefined, requestLog),
    });

    const realtimeRequest = requestLog.find(({ url }) => url.pathname === '/realtime/v1/websocket');
    const realtimeHeaders = new Headers(realtimeRequest?.init?.headers);

    expect(result.ok).toBe(true);
    expect(result.offlineArtifactOk).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.probes.every((probe) => probe.ok)).toBe(true);
    expect(result.probes.find((probe) => probe.name === 'functions_preserved')?.status).toBe(400);
    expect(result.probes.find((probe) => probe.name === 'supauth_function_health_preserved')?.status).toBe(200);
    expect(realtimeRequest?.url.searchParams.get('vsn')).toBe('1.0.0');
    expect(realtimeHeaders.get('connection')).toBe('Upgrade');
    expect(realtimeHeaders.get('upgrade')).toBe('websocket');
    expect(realtimeHeaders.get('sec-websocket-version')).toBe('13');
    expect(realtimeHeaders.get('sec-websocket-key')).toBe('dGhlIHNhbXBsZSBub25jZQ==');
  });

  it('fails instead of pretending live verification passed when deployed URLs are missing', async () => {
    const { root, artifactDir } = createFixture();

    const result = await verifySupacloudInstalledApp({
      root,
      artifactDir,
      fetchImpl: mockFetch(),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Missing deployed SupAuth base URL: set --base-url, SUPAUTH_PUBLIC_URL, or SUPAUTH_INSTALLED_BASE_URL');
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

  it('rejects missing PostgREST, Storage, or Realtime runtime routes instead of accepting generic 404s', async () => {
    const { root, artifactDir } = createFixture();

    const result = await verifySupacloudInstalledApp({
      root,
      artifactDir,
      baseUrl: 'https://auth.example.test',
      runtimeUrl: 'https://project.example.test',
      fetchImpl: mockFetch({
        '/rest/v1/': 404,
        '/storage/v1/bucket': 404,
        '/realtime/v1/websocket': 404,
        '/functions/v1/': 404,
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('postgrest_preserved failed: expected HTTP status in [200, 401, 406], got HTTP 404');
    expect(result.errors).toContain('storage_preserved failed: expected HTTP status in [200, 401], got HTTP 404');
    expect(result.errors).toContain('realtime_preserved failed: expected HTTP status in [400, 401, 403, 426], got HTTP 404');
    expect(result.errors.some((error) => error.includes('functions_preserved'))).toBe(false);
  });

  it('rejects a missing named SupAuth Function even when the empty slug response is valid', async () => {
    const { root, artifactDir } = createFixture();

    const result = await verifySupacloudInstalledApp({
      root,
      artifactDir,
      baseUrl: 'https://auth.example.test',
      runtimeUrl: 'https://project.example.test',
      fetchImpl: mockFetch({ '/functions/v1/supauth/api/v1/health': 404 }),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('supauth_function_health_preserved failed: expected HTTP 200, got HTTP 404');
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

  it('accepts a live SSO authorize probe when the redirect stays on the hosted auth domain', async () => {
    const { root, artifactDir } = createFixture();

    const result = await verifySupacloudInstalledApp({
      root,
      artifactDir,
      baseUrl: 'https://auth.example.test',
      runtimeUrl: 'https://project.example.test',
      ssoAuthorizeProbeUrl: 'https://auth.example.test/oauth/sso/authorize?response_type=code&client_id=app_123&redirect_uri=https%3A%2F%2Fapp.example.test%2Fcallback',
      fetchImpl: mockFetch({ '/oauth/sso/authorize': 302 }),
    });

    expect(result.ok).toBe(true);
    expect(result.probes.find((probe) => probe.name === 'sso_authorize_redirect_origin')?.ok).toBe(true);
  });

  it('accepts a live SSO authorize probe when the first hosted auth redirect uses http before HTTPS upgrade', async () => {
    const { root, artifactDir } = createFixture();

    const result = await verifySupacloudInstalledApp({
      root,
      artifactDir,
      baseUrl: 'https://auth.example.test',
      runtimeUrl: 'https://project.example.test',
      ssoAuthorizeProbeUrl: 'https://auth.example.test/oauth/sso/authorize?response_type=code&client_id=app_123&redirect_uri=https%3A%2F%2Fapp.example.test%2Fcallback',
      fetchImpl: mockFetch(
        { '/oauth/sso/authorize': 302 },
        'http://auth.example.test/auth/v1/oauth/authorize?client_id=app_123',
      ),
    });

    expect(result.ok).toBe(true);
    expect(result.probes.find((probe) => probe.name === 'sso_authorize_redirect_origin')?.ok).toBe(true);
  });

  it('rejects a live SSO authorize probe when the redirect leaks the project runtime domain', async () => {
    const { root, artifactDir } = createFixture();

    const result = await verifySupacloudInstalledApp({
      root,
      artifactDir,
      baseUrl: 'https://auth.example.test',
      runtimeUrl: 'https://project.example.test',
      ssoAuthorizeProbeUrl: 'https://auth.example.test/oauth/sso/authorize?response_type=code&client_id=app_123&redirect_uri=https%3A%2F%2Fapp.example.test%2Fcallback',
      fetchImpl: mockFetch(),
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes('expected 3xx Location to stay on hosted GoTrue authorize path'))).toBe(true);
  });

  it('rejects a live SSO authorize probe when the hosted GoTrue authorize target is missing', async () => {
    const { root, artifactDir } = createFixture();

    const result = await verifySupacloudInstalledApp({
      root,
      artifactDir,
      baseUrl: 'https://auth.example.test',
      runtimeUrl: 'https://project.example.test',
      ssoAuthorizeProbeUrl: 'https://auth.example.test/oauth/sso/authorize?response_type=code&client_id=app_123&redirect_uri=https%3A%2F%2Fapp.example.test%2Fcallback',
      fetchImpl: mockFetch({
        '/oauth/sso/authorize': 302,
        '/auth/v1/oauth/authorize': 404,
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes('hosted GoTrue authorize target failed'))).toBe(true);
  });
});
