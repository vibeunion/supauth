import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSupacloudAppManifest } from '../scripts/supacloud-app-contract.js';
import { verifySupacloudInstalledApp } from '../scripts/verify-supacloud-installed-app.js';

const legacyCustomUiProbePath = '/custom-ui/legacy/index.html';
const publicCustomUiProbePath = '/v1/public/custom-ui/legacy/index.html';

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
  writeFileSync(join(root, adminDir, 'logout.html'), '<!doctype html>');
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

const OMIT_REDIRECT_LOCATION = Symbol('omit-redirect-location');
type MockResponseHeaders = HeadersInit | typeof OMIT_REDIRECT_LOCATION;

function headersForMockResponse(config?: MockResponseHeaders) {
  return new Headers(config === OMIT_REDIRECT_LOCATION ? undefined : config);
}

function mockFetch(
  overrides: Record<string, number> = {},
  ssoAuthorizeLocation?: string,
  requestLog: MockFetchRequest[] = [],
  responseHeaders: Record<string, MockResponseHeaders> = {},
) {
  const defaultStatuses: Record<string, number> = {
    '/api/v1/health': 200,
    '/api/v1/capabilities': 401,
    '/v1/auth-config': 401,
    '/v1/public/sign-in-experience/resolve': 200,
    [legacyCustomUiProbePath]: 404,
    [publicCustomUiProbePath]: 404,
    '/admin': 307,
    '/admin/get-started': 200,
    '/admin/security': 307,
    '/admin/security/password': 200,
    '/admin/_app/version.json': 200,
    '/login': 200,
    '/login.html': 200,
    '/authorize.html': 200,
    '/logout': 200,
    '/logout.html': 200,
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
    if (url.protocol === 'http:' && url.pathname.startsWith('/.well-known/supauth-https-redirect/')) {
      const status = overrides[url.pathname] ?? 308;
      const configuredHeaders = responseHeaders[url.pathname];
      const headers = headersForMockResponse(configuredHeaders);
      if (configuredHeaders !== OMIT_REDIRECT_LOCATION && !headers.has('location')) {
        const redirectUrl = new URL(url);
        redirectUrl.protocol = 'https:';
        headers.set('location', redirectUrl.toString());
      }
      return new Response('redirect', { status, headers });
    }
    if (url.pathname === '/oauth/sso/authorize' && url.searchParams.has('client_id')) {
      const location = overrides['/oauth/sso/authorize'] === 302
        ? ssoAuthorizeLocation || 'https://auth.example.test/auth/v1/oauth/authorize?client_id=app_123'
        : 'https://project.example.test/auth/v1/oauth/authorize?client_id=app_123';
      return new Response('redirect', { status: 302, headers: { location } });
    }
    const status = defaultStatuses[url.pathname] ?? 404;
    const configuredHeaders = responseHeaders[url.pathname];
    const headers = headersForMockResponse(configuredHeaders);
    if ((url.pathname === legacyCustomUiProbePath || url.pathname === publicCustomUiProbePath)
      && configuredHeaders === undefined) {
      headers.set('cache-control', 'private, No-Store');
    }
    if (url.pathname === '/admin' && status === 307 && !headers.has('location')) {
      headers.set('location', '/admin/get-started');
    }
    if (url.pathname === '/admin/security' && status === 307 && !headers.has('location')) {
      headers.set('location', '/admin/security/password');
    }
    if (url.pathname === '/admin/get-started' && status === 200 && !headers.has('content-type')) {
      headers.set('content-type', 'text/html; charset=utf-8');
    }
    if (url.pathname === '/admin/security/password' && status === 200 && !headers.has('content-type')) {
      headers.set('content-type', 'text/html; charset=utf-8');
    }
    if (url.pathname === '/admin/_app/version.json' && status === 200 && !headers.has('content-type')) {
      headers.set('content-type', 'application/json; charset=utf-8');
    }
    return new Response(status === 200 ? 'ok' : 'probe', { status, headers });
  };
}

describe('SupaCloud installed app verifier', () => {
  it('accepts an installed SupAuth app with Function, Pages, and preserved runtime routes', async () => {
    const { root, artifactDir } = createFixture();
    const requestLog: MockFetchRequest[] = [];

    const verification = await verifySupacloudInstalledApp({
      root,
      artifactDir,
      baseUrl: 'https://auth.example.test',
      runtimeUrl: 'https://project.example.test',
      fetchImpl: mockFetch({}, undefined, requestLog),
    });

    const realtimeRequest = requestLog.find(({ url }) => url.pathname === '/realtime/v1/websocket');
    const realtimeHeaders = new Headers(realtimeRequest?.init?.headers);

    expect(verification.ok).toBe(true);
    expect(verification.offlineArtifactOk).toBe(true);
    expect(verification.errors).toEqual([]);
    expect(verification.probes.every((probe) => probe.ok)).toBe(true);
    expect(verification.probes.find((probe) => probe.name === 'functions_preserved')?.status).toBe(400);
    expect(verification.probes.find((probe) => probe.name === 'supauth_function_health_preserved')?.status).toBe(200);
    expect(verification.probes.find((probe) => probe.name === 'custom_ui_legacy_inert')).toMatchObject({
      ok: true,
      status: 404,
    });
    expect(verification.probes.find((probe) => probe.name === 'public_custom_ui_legacy_inert')).toMatchObject({
      ok: true,
      status: 404,
    });
    expect(verification.probes.find((probe) => probe.name === 'public_http_to_https')).toMatchObject({
      ok: true,
      status: 308,
    });
    expect(verification.probes.find((probe) => probe.name === 'runtime_http_to_https')).toMatchObject({
      ok: true,
      status: 308,
    });
    const publicRedirectRequest = requestLog.find(({ url }) => url.protocol === 'http:' && url.pathname.endsWith('/public/path'));
    const runtimeRedirectRequest = requestLog.find(({ url }) => url.protocol === 'http:' && url.pathname.endsWith('/runtime/path'));
    expect(publicRedirectRequest?.url.search).toBe('?source=public%2Fprobe&keep=1');
    expect(runtimeRedirectRequest?.url.search).toBe('?source=runtime%2Fprobe&keep=1');
    expect(realtimeRequest?.url.searchParams.get('vsn')).toBe('1.0.0');
    expect(realtimeHeaders.get('connection')).toBe('Upgrade');
    expect(realtimeHeaders.get('upgrade')).toBe('websocket');
    expect(realtimeHeaders.get('sec-websocket-version')).toBe('13');
    expect(realtimeHeaders.get('sec-websocket-key')).toBe('dGhlIHNhbXBsZSBub25jZQ==');
  });

  it('accepts SupaCloud 0.50.2 protected PostgREST schema responses', async () => {
    const { root, artifactDir } = createFixture();

    const verification = await verifySupacloudInstalledApp({
      root,
      artifactDir,
      baseUrl: 'https://auth.example.test',
      runtimeUrl: 'https://project.example.test',
      fetchImpl: mockFetch({ '/rest/v1/': 403 }),
    });

    expect(verification.ok).toBe(true);
    expect(verification.probes.find((probe) => probe.name === 'postgrest_preserved')).toMatchObject({
      ok: true,
      status: 403,
    });
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

  it('rejects Custom UI negative probes that do not return 404', async () => {
    const { root, artifactDir } = createFixture();

    const result = await verifySupacloudInstalledApp({
      root,
      artifactDir,
      baseUrl: 'https://auth.example.test',
      runtimeUrl: 'https://project.example.test',
      fetchImpl: mockFetch({
        [legacyCustomUiProbePath]: 200,
        [publicCustomUiProbePath]: 500,
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      'custom_ui_legacy_inert failed: expected HTTP 404 with Cache-Control no-store, got HTTP 200',
    );
    expect(result.errors).toContain(
      'public_custom_ui_legacy_inert failed: expected HTTP 404 with Cache-Control no-store, got HTTP 500',
    );
  });

  it('requires an independent no-store directive on both Custom UI negative probes', async () => {
    const { root, artifactDir } = createFixture();

    const result = await verifySupacloudInstalledApp({
      root,
      artifactDir,
      baseUrl: 'https://auth.example.test',
      runtimeUrl: 'https://project.example.test',
      fetchImpl: mockFetch({}, undefined, [], {
        [legacyCustomUiProbePath]: { 'cache-control': 'private, no-store-if-error' },
        [publicCustomUiProbePath]: {},
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      'custom_ui_legacy_inert failed: expected HTTP 404 with Cache-Control no-store, got HTTP 404 Cache-Control private, no-store-if-error',
    );
    expect(result.errors).toContain(
      'public_custom_ui_legacy_inert failed: expected HTTP 404 with Cache-Control no-store, got HTTP 404 Cache-Control <empty>',
    );
  });

  it('rejects a missing Admin Console redirect target or static asset', async () => {
    const { root, artifactDir } = createFixture();

    const verification = await verifySupacloudInstalledApp({
      root,
      artifactDir,
      baseUrl: 'https://auth.example.test',
      runtimeUrl: 'https://project.example.test',
      fetchImpl: mockFetch({
        '/admin/security/password': 404,
        '/admin/_app/version.json': 404,
      }),
    });

    expect(verification.ok).toBe(false);
    expect(verification.errors).toContain('admin_console_page failed: redirect target expected HTTP 200, got HTTP 404');
    expect(verification.errors).toContain('admin_console_static_asset failed: expected HTTP 200, got HTTP 404');
  });

  it('rejects a missing exact Admin Console root route', async () => {
    const { root, artifactDir } = createFixture();

    const verification = await verifySupacloudInstalledApp({
      root,
      artifactDir,
      baseUrl: 'https://auth.example.test',
      runtimeUrl: 'https://project.example.test',
      fetchImpl: mockFetch({ '/admin': 404 }),
    });

    expect(verification.ok).toBe(false);
    expect(verification.errors).toContain(
      'admin_console_root failed: expected HTTP 307 to same-origin /admin/get-started, got HTTP 404 Location <empty>',
    );
  });

  it('rejects an Admin Console root redirect to the wrong location', async () => {
    const { root, artifactDir } = createFixture();

    const verification = await verifySupacloudInstalledApp({
      root,
      artifactDir,
      baseUrl: 'https://auth.example.test',
      runtimeUrl: 'https://project.example.test',
      fetchImpl: mockFetch({}, undefined, [], {
        '/admin': { location: '/admin/login' },
      }),
    });

    expect(verification.ok).toBe(false);
    expect(verification.errors).toContain(
      'admin_console_root failed: expected HTTP 307 to same-origin /admin/get-started, got HTTP 307 Location /admin/login',
    );
  });

  it('rejects a missing Admin Console root redirect target', async () => {
    const { root, artifactDir } = createFixture();

    const verification = await verifySupacloudInstalledApp({
      root,
      artifactDir,
      baseUrl: 'https://auth.example.test',
      runtimeUrl: 'https://project.example.test',
      fetchImpl: mockFetch({ '/admin/get-started': 404 }),
    });

    expect(verification.ok).toBe(false);
    expect(verification.errors).toContain(
      'admin_console_root failed: redirect target expected HTTP 200, got HTTP 404',
    );
  });

  it('rejects unsafe Admin Console response media types', async () => {
    const { root, artifactDir } = createFixture();

    const verification = await verifySupacloudInstalledApp({
      root,
      artifactDir,
      baseUrl: 'https://auth.example.test',
      runtimeUrl: 'https://project.example.test',
      fetchImpl: mockFetch({}, undefined, [], {
        '/admin/security/password': { 'content-type': 'application/octet-stream' },
        '/admin/_app/version.json': { 'content-type': 'application/octet-stream' },
      }),
    });

    expect(verification.ok).toBe(false);
    expect(verification.errors.some((error) => error.includes('expected text/html'))).toBe(true);
    expect(verification.errors.some((error) => error.includes('expected application/json'))).toBe(true);
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
    expect(result.errors).toContain('postgrest_preserved failed: expected HTTP status in [200, 401, 403, 406], got HTTP 404');
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

  const publicRedirectPath = '/.well-known/supauth-https-redirect/public/path';
  const expectedPublicRedirect = `https://auth.example.test${publicRedirectPath}?source=public%2Fprobe&keep=1`;
  for (const invalidRedirect of [
    {
      name: 'cross-host target',
      status: 308,
      location: `https://attacker.example.test${publicRedirectPath}?source=public%2Fprobe&keep=1`,
    },
    {
      name: 'changed path',
      status: 308,
      location: 'https://auth.example.test/changed?source=public%2Fprobe&keep=1',
    },
    {
      name: 'missing query parameter',
      status: 308,
      location: `https://auth.example.test${publicRedirectPath}?source=public%2Fprobe`,
    },
    {
      name: 'relative Location',
      status: 308,
      location: `${publicRedirectPath}?source=public%2Fprobe&keep=1`,
    },
    {
      name: 'cleartext Location',
      status: 308,
      location: `http://auth.example.test${publicRedirectPath}?source=public%2Fprobe&keep=1`,
    },
    {
      name: 'temporary redirect status',
      status: 307,
      location: expectedPublicRedirect,
    },
  ] as const) {
    it(`rejects an HTTP upgrade with ${invalidRedirect.name}`, async () => {
      const { root, artifactDir } = createFixture();

      const result = await verifySupacloudInstalledApp({
        root,
        artifactDir,
        baseUrl: 'https://auth.example.test',
        runtimeUrl: 'https://project.example.test',
        fetchImpl: mockFetch({ [publicRedirectPath]: invalidRedirect.status }, undefined, [], {
          [publicRedirectPath]: { location: invalidRedirect.location },
        }),
      });

      expect(result.ok).toBe(false);
      expect(result.errors).toContain(
        `public_http_to_https failed: expected HTTP 308 Location ${expectedPublicRedirect}, got HTTP ${invalidRedirect.status} Location ${invalidRedirect.location}`,
      );
    });
  }

  it('rejects an HTTP 308 redirect without Location', async () => {
    const { root, artifactDir } = createFixture();

    const result = await verifySupacloudInstalledApp({
      root,
      artifactDir,
      baseUrl: 'https://auth.example.test',
      runtimeUrl: 'https://project.example.test',
      fetchImpl: mockFetch({ [publicRedirectPath]: 308 }, undefined, [], {
        [publicRedirectPath]: OMIT_REDIRECT_LOCATION,
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      `public_http_to_https failed: expected HTTP 308 Location ${expectedPublicRedirect}, got HTTP 308 Location <empty>`,
    );
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

  it('rejects a live SSO authorize probe when the hosted auth redirect uses HTTP', async () => {
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

    expect(result.ok).toBe(false);
    expect(result.probes.find((probe) => probe.name === 'sso_authorize_redirect_origin')?.ok).toBe(false);
    expect(result.errors.some((error) => error.includes('expected 3xx Location to stay on hosted GoTrue authorize path'))).toBe(true);
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
