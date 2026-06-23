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

function isExpectedStatus(status: number, expectation: ProbeExpectation) {
  if (expectation === 'exact-200') return status === 200;
  if (expectation === 'route-exists') return status >= 200 && status < 500 && status !== 404;
  return status >= 200 && status < 500;
}

function describeExpectation(expectation: ProbeExpectation) {
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

async function probe(fetchImpl: FetchLike, name: string, url: string, expectation: ProbeExpectation): Promise<ProbeResult> {
  try {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'manual' });
    const ok = isExpectedStatus(response.status, expectation);
    return {
      name,
      url,
      expectation,
      ok,
      status: response.status,
      error: ok ? undefined : `${describeExpectation(expectation)}, got HTTP ${response.status}`,
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
    const attempt = await probe(fetchImpl, name, url, expectation);
    attempts.push(attempt);
    if (attempt.ok) return { ok: true, attempts };
  }
  return { ok: false, attempts };
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
  const requiredSupauthProbes: Array<[string, string, ProbeExpectation]> = [
    ['supauth_health_api_strip_prefix', joinUrl(baseUrl, '/api/v1/health'), 'exact-200'],
    ['supauth_management_api', joinUrl(baseUrl, '/v1/auth-config'), 'route-exists'],
    ['public_sign_in_experience', joinUrl(baseUrl, '/v1/public/sign-in-experience/resolve'), 'route-exists'],
    ['admin_console_page', joinUrl(baseUrl, '/admin/security'), 'exact-200'],
    ['hosted_login_path', joinUrl(baseUrl, '/login'), 'exact-200'],
    ['hosted_login_page', joinUrl(baseUrl, '/login.html'), 'exact-200'],
    ['hosted_authorize_page', joinUrl(baseUrl, '/authorize.html'), 'exact-200'],
    ['account_center_page', joinUrl(baseUrl, '/account'), 'exact-200'],
    ['account_center_html', joinUrl(baseUrl, '/account.html'), 'exact-200'],
    ['change_password_page', joinUrl(baseUrl, '/account/password'), 'exact-200'],
    ['account_claim_page', joinUrl(baseUrl, '/claim'), 'exact-200'],
    ['account_claim_html', joinUrl(baseUrl, '/claim.html'), 'exact-200'],
    ['favicon', joinUrl(baseUrl, '/favicon.ico'), 'exact-200'],
  ];
  const requiredRuntimeProbes: Array<[string, string, ProbeExpectation]> = [
    ['gotrue_health_preserved', joinUrl(runtimeUrl, '/auth/v1/health'), 'exact-200'],
    ['postgrest_preserved', joinUrl(runtimeUrl, '/rest/v1/'), 'runtime-preserved'],
    ['storage_preserved', joinUrl(runtimeUrl, '/storage/v1/bucket'), 'runtime-preserved'],
    ['realtime_preserved', joinUrl(runtimeUrl, '/realtime/v1/websocket'), 'runtime-preserved'],
    ['functions_preserved', joinUrl(runtimeUrl, '/functions/v1/'), 'runtime-preserved'],
  ];

  for (const [name, url, expectation] of requiredSupauthProbes) {
    result.probes.push(await probe(fetchImpl, name, url, expectation));
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

  for (const [name, url, expectation] of requiredRuntimeProbes) {
    result.probes.push(await probe(fetchImpl, name, url, expectation));
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
