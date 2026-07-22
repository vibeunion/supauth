#!/usr/bin/env bun
/**
 * Live verifier for a SupAuth app after SupaCloud has installed the manifest.
 *
 * This intentionally requires deployed URLs. Without them, the verifier fails
 * instead of treating offline artifact checks as a live install proof.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifySupacloudAppArtifact } from './verify-supacloud-app-artifact.js';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type ProbeExpectation = 'exact-200' | 'route-exists' | 'runtime-preserved';

interface ProbeSpec {
  name: string;
  url: string;
  expectation: ProbeExpectation;
  allowedStatuses?: number[];
  headers?: HeadersInit;
}

interface ProbeResult {
  name: string;
  url: string;
  expectation: ProbeExpectation;
  ok: boolean;
  status?: number;
  error?: string;
}

interface InstalledAppVerificationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifestPath: string;
  manifestHash?: string;
  offlineArtifactOk: boolean;
  probes: ProbeResult[];
}

const realtimeWebsocketHeaders: HeadersInit = {
  Connection: 'Upgrade',
  Upgrade: 'websocket',
  'Sec-WebSocket-Version': '13',
  'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
};

function option(name: string) {
  const index = Bun.argv.indexOf(`--${name}`);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}

function normalizeBaseUrl(name: string, value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${name} must be a valid URL: ${value}`);
  }
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function sha256File(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function isExpectedStatus(status: number, expectation: ProbeExpectation, allowedStatuses?: number[]) {
  if (allowedStatuses) return allowedStatuses.includes(status);
  if (expectation === 'exact-200') return status === 200;
  if (expectation === 'route-exists') return status >= 200 && status < 500 && status !== 404;
  return status >= 200 && status < 500;
}

function describeExpectation(expectation: ProbeExpectation, allowedStatuses?: number[]) {
  if (allowedStatuses) return `expected HTTP status in [${allowedStatuses.join(', ')}]`;
  if (expectation === 'exact-200') return 'expected HTTP 200';
  if (expectation === 'route-exists') return 'expected a non-404, non-5xx route response';
  return 'expected preserved Supabase runtime route to avoid upstream 5xx';
}

function isHostedGoTrueAuthorizeLocation(location: string, baseUrl: string) {
  try {
    const actual = new URL(location, baseUrl);
    const expected = new URL(baseUrl);
    return actual.host === expected.host
      && actual.pathname === '/auth/v1/oauth/authorize'
      && (actual.protocol === 'https:' || actual.protocol === 'http:');
  } catch {
    return false;
  }
}

async function probe(fetchImpl: FetchLike, spec: ProbeSpec): Promise<ProbeResult> {
  const { name, url, expectation, allowedStatuses, headers } = spec;
  try {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'manual', headers });
    const ok = isExpectedStatus(response.status, expectation, allowedStatuses);
    return {
      name,
      url,
      expectation,
      ok,
      status: response.status,
      error: ok ? undefined : `${describeExpectation(expectation, allowedStatuses)}, got HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      name,
      url,
      expectation,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeAny(fetchImpl: FetchLike, name: string, candidates: string[], expectation: ProbeExpectation) {
  const attempts: ProbeResult[] = [];
  for (const url of candidates) {
    const attempt = await probe(fetchImpl, { name, url, expectation });
    attempts.push(attempt);
    if (attempt.ok) return { ok: true, attempts };
  }
  return { ok: false, attempts };
}

function failedAdminConsoleProbe(url: string, error: string, status?: number): ProbeResult {
  return { name: 'admin_console_page', url, expectation: 'exact-200', ok: false, status, error };
}

function canonicalAdminConsoleTarget(response: Response, entryUrl: string) {
  const location = response.headers.get('location') || '';
  const redirectUrl = new URL(location, entryUrl);
  const expectedOrigin = new URL(entryUrl).origin;
  return response.status === 307
    && redirectUrl.origin === expectedOrigin
    && redirectUrl.pathname === '/admin/security/password'
    ? redirectUrl
    : null;
}

async function probeAdminConsoleRedirect(fetchImpl: FetchLike, entryUrl: string): Promise<ProbeResult> {
  try {
    const response = await fetchImpl(entryUrl, { method: 'GET', redirect: 'manual' });
    const redirectUrl = canonicalAdminConsoleTarget(response, entryUrl);
    if (!redirectUrl) {
      const location = response.headers.get('location') || '<empty>';
      return failedAdminConsoleProbe(entryUrl, `expected HTTP 307 to same-origin /admin/security/password, got HTTP ${response.status} Location ${location}`, response.status);
    }
    const targetProbe = await probe(fetchImpl, {
      name: 'admin_console_page', url: redirectUrl.toString(), expectation: 'exact-200',
    });
    return targetProbe.ok || !targetProbe.error
      ? targetProbe
      : { ...targetProbe, error: `redirect target ${targetProbe.error}` };
  } catch (error) {
    return failedAdminConsoleProbe(entryUrl, error instanceof Error ? error.message : String(error));
  }
}

async function probeSsoAuthorizeRedirect(fetchImpl: FetchLike, url: string, baseUrl: string): Promise<ProbeResult> {
  try {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'manual' });
    const location = response.headers.get('location') || '';
    const expectedPrefix = joinUrl(baseUrl, '/auth/v1/oauth/authorize?');
    const redirectsToHostedAuth = response.status >= 300 && response.status < 400 && isHostedGoTrueAuthorizeLocation(location, baseUrl);
    if (!redirectsToHostedAuth) {
      return {
        name: 'sso_authorize_redirect_origin',
        url,
        expectation: 'route-exists',
        ok: false,
        status: response.status,
        error: `expected 3xx Location to stay on hosted GoTrue authorize path ${expectedPrefix}, got HTTP ${response.status} Location ${location || '<empty>'}`,
      };
    }

    const authorizeResponse = await fetchImpl(location, { method: 'GET', redirect: 'manual' });
    const ok = isExpectedStatus(authorizeResponse.status, 'route-exists');
    return {
      name: 'sso_authorize_redirect_origin',
      url,
      expectation: 'route-exists',
      ok,
      status: authorizeResponse.status,
      error: ok ? undefined : `hosted GoTrue authorize target failed: expected a non-404, non-5xx route response, got HTTP ${authorizeResponse.status} at ${location}`,
    };
  } catch (error) {
    return {
      name: 'sso_authorize_redirect_origin',
      url,
      expectation: 'route-exists',
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function verifySupacloudInstalledApp(input: {
  root?: string;
  artifactDir?: string;
  manifestPath?: string;
  baseUrl?: string;
  runtimeUrl?: string;
  expectedManifestHash?: string;
  ssoAuthorizeProbeUrl?: string;
  fetchImpl?: FetchLike;
} = {}): Promise<InstalledAppVerificationResult> {
  const root = resolve(input.root || new URL('..', import.meta.url).pathname);
  const offline = verifySupacloudAppArtifact({
    root,
    artifactDir: input.artifactDir,
    manifestPath: input.manifestPath,
  });
  const result: InstalledAppVerificationResult = {
    ok: false,
    errors: [...offline.errors],
    warnings: [...offline.warnings],
    manifestPath: offline.manifestPath,
    offlineArtifactOk: offline.ok,
    probes: [],
  };

  if (existsSync(offline.manifestPath)) {
    result.manifestHash = sha256File(offline.manifestPath);
  }

  if (input.expectedManifestHash && result.manifestHash !== input.expectedManifestHash) {
    result.errors.push(`Installed verifier manifest hash mismatch: expected ${input.expectedManifestHash}, got ${result.manifestHash || 'missing'}`);
  }

  let baseUrl: string | undefined;
  let runtimeUrl: string | undefined;
  try {
    baseUrl = normalizeBaseUrl('baseUrl', input.baseUrl);
    runtimeUrl = normalizeBaseUrl('runtimeUrl', input.runtimeUrl);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }

  if (!baseUrl) result.errors.push('Missing deployed SupAuth base URL: set --base-url, SUPAUTH_PUBLIC_URL, or SUPAUTH_INSTALLED_BASE_URL');
  if (!runtimeUrl) result.errors.push('Missing SupaCloud runtime URL: set --runtime-url or SUPAUTH_INSTALLED_RUNTIME_URL');
  if (!offline.ok || !baseUrl || !runtimeUrl) {
    result.ok = result.errors.length === 0;
    return result;
  }

  const fetchImpl = input.fetchImpl || fetch;
  const requiredSupauthProbes: ProbeSpec[] = [
    { name: 'supauth_health_api_strip_prefix', url: joinUrl(baseUrl, '/api/v1/health'), expectation: 'exact-200' },
    { name: 'supauth_capabilities', url: joinUrl(baseUrl, '/api/v1/capabilities'), expectation: 'route-exists', allowedStatuses: [200, 401, 403] },
    { name: 'supauth_management_api', url: joinUrl(baseUrl, '/v1/auth-config'), expectation: 'route-exists' },
    { name: 'public_sign_in_experience', url: joinUrl(baseUrl, '/v1/public/sign-in-experience/resolve'), expectation: 'route-exists' },
    { name: 'admin_console_static_asset', url: joinUrl(baseUrl, '/admin/_app/version.json'), expectation: 'exact-200' },
    { name: 'hosted_login_path', url: joinUrl(baseUrl, '/login'), expectation: 'exact-200' },
    { name: 'hosted_login_page', url: joinUrl(baseUrl, '/login.html'), expectation: 'exact-200' },
    { name: 'hosted_authorize_page', url: joinUrl(baseUrl, '/authorize.html'), expectation: 'exact-200' },
    { name: 'hosted_logout_path', url: joinUrl(baseUrl, '/logout'), expectation: 'exact-200' },
    { name: 'hosted_logout_page', url: joinUrl(baseUrl, '/logout.html'), expectation: 'exact-200' },
    { name: 'account_center_page', url: joinUrl(baseUrl, '/account'), expectation: 'exact-200' },
    { name: 'account_center_html', url: joinUrl(baseUrl, '/account.html'), expectation: 'exact-200' },
    { name: 'change_password_page', url: joinUrl(baseUrl, '/account/password'), expectation: 'exact-200' },
    { name: 'account_claim_page', url: joinUrl(baseUrl, '/claim'), expectation: 'exact-200' },
    { name: 'account_claim_html', url: joinUrl(baseUrl, '/claim.html'), expectation: 'exact-200' },
    { name: 'favicon', url: joinUrl(baseUrl, '/favicon.ico'), expectation: 'exact-200' },
  ];
  const requiredRuntimeProbes: ProbeSpec[] = [
    { name: 'gotrue_health_preserved', url: joinUrl(runtimeUrl, '/auth/v1/health'), expectation: 'exact-200' },
    { name: 'gotrue_oidc_discovery_preserved', url: joinUrl(runtimeUrl, '/auth/v1/.well-known/openid-configuration'), expectation: 'exact-200' },
    { name: 'gotrue_jwks_preserved', url: joinUrl(runtimeUrl, '/auth/v1/.well-known/jwks.json'), expectation: 'exact-200' },
    { name: 'postgrest_preserved', url: joinUrl(runtimeUrl, '/rest/v1/'), expectation: 'runtime-preserved', allowedStatuses: [200, 401, 406] },
    { name: 'storage_preserved', url: joinUrl(runtimeUrl, '/storage/v1/bucket'), expectation: 'runtime-preserved', allowedStatuses: [200, 401] },
    {
      name: 'realtime_preserved',
      url: joinUrl(runtimeUrl, '/realtime/v1/websocket?vsn=1.0.0'),
      expectation: 'runtime-preserved',
      allowedStatuses: [400, 401, 403, 426],
      headers: realtimeWebsocketHeaders,
    },
    { name: 'functions_preserved', url: joinUrl(runtimeUrl, '/functions/v1/'), expectation: 'runtime-preserved', allowedStatuses: [200, 400, 401, 404] },
    { name: 'supauth_function_health_preserved', url: joinUrl(runtimeUrl, '/functions/v1/supauth/api/v1/health'), expectation: 'exact-200' },
  ];

  result.probes.push(await probeAdminConsoleRedirect(fetchImpl, joinUrl(baseUrl, '/admin/security')));
  for (const probeSpec of requiredSupauthProbes) {
    result.probes.push(await probe(fetchImpl, probeSpec));
  }

  const oauthProbe = await probeAny(fetchImpl, 'oauth_authorize_route', [
    joinUrl(baseUrl, '/oauth/authorize'),
    joinUrl(baseUrl, '/oauth/sso/authorize'),
  ], 'route-exists');
  result.probes.push(...oauthProbe.attempts);
  if (!oauthProbe.ok) {
    result.errors.push('No hosted OAuth authorize route responded as an installed SupAuth Function route');
  }

  if (input.ssoAuthorizeProbeUrl) {
    result.probes.push(await probeSsoAuthorizeRedirect(fetchImpl, input.ssoAuthorizeProbeUrl, baseUrl));
  }

  for (const probeSpec of requiredRuntimeProbes) {
    result.probes.push(await probe(fetchImpl, probeSpec));
  }

  for (const failedProbe of result.probes.filter((item) => !item.ok)) {
    result.errors.push(`${failedProbe.name} failed: ${failedProbe.error || 'probe failed'}`);
  }

  result.ok = result.errors.length === 0;
  return result;
}

if (import.meta.main) {
  const outputPath = option('output');
  const result = await verifySupacloudInstalledApp({
    artifactDir: option('artifact-dir'),
    manifestPath: option('manifest'),
    baseUrl: option('base-url') || process.env.SUPAUTH_PUBLIC_URL || process.env.AUTH_PUBLIC_URL || process.env.SUPAUTH_INSTALLED_BASE_URL,
    runtimeUrl: option('runtime-url') || process.env.SUPAUTH_INSTALLED_RUNTIME_URL,
    expectedManifestHash: option('expected-manifest-hash') || process.env.SUPAUTH_EXPECTED_MANIFEST_HASH,
    ssoAuthorizeProbeUrl: option('sso-authorize-probe-url') || process.env.SUPAUTH_SSO_AUTHORIZE_PROBE_URL,
  });
  const serialized = `${JSON.stringify(result, null, 2)}\n`;

  if (outputPath) {
    writeFileSync(resolve(outputPath), serialized);
  }
  console.log(serialized.trimEnd());
  if (!result.ok) process.exit(1);
}
