#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type JsonObject = Record<string, unknown>;

export interface ThirdPartyAuthConfig {
  enabled: boolean;
  issuer: string;
  jwks_url: string;
  audience: string | string[];
  client_id: string;
  auth_endpoint_mode: 'local' | 'external';
  auth_upstream?: string;
  auth_host_header?: string;
  auth_upstream_tls_insecure_skip_verify?: boolean;
  claim_mapping: Record<string, string>;
}

export interface ApplyThirdPartyAuthOptions {
  baseUrl: string;
  projectRef: string;
  configPath: string;
  token?: string;
  dryRun?: boolean;
  outputPath?: string;
  fetchImpl?: typeof fetch;
}

const REQUEST_TIMEOUT_MS = 15_000;
const ALLOWED_KEYS = new Set([
  'enabled',
  'issuer',
  'jwks_url',
  'audience',
  'client_id',
  'auth_endpoint_mode',
  'auth_upstream',
  'auth_host_header',
  'auth_upstream_tls_insecure_skip_verify',
  'claim_mapping',
]);
const ALLOWED_CLAIM_KEYS = new Set(['sub', 'role', 'email', 'phone', 'session_id', 'aal', 'is_anonymous']);

function isRecord(candidate: unknown): candidate is JsonObject {
  return Boolean(candidate) && typeof candidate === 'object' && !Array.isArray(candidate);
}

function requiredString(candidate: unknown, path: string) {
  if (typeof candidate !== 'string' || !candidate.trim()) throw new Error(`${path} must be a non-empty string.`);
  return candidate.trim();
}

function validateHttpUrl(candidate: unknown, path: string) {
  const raw = requiredString(candidate, path);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${path} must be an absolute URL.`);
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error(`${path} must use HTTPS (HTTP is allowed only for localhost tests).`);
  }
  return url.toString().replace(/\/$/, '');
}

function validateAudience(candidate: unknown) {
  if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw new Error('third_party_auth.audience must be a non-empty string or string array.');
  }
  const normalized = candidate.map((audience, index) => requiredString(audience, `third_party_auth.audience[${index}]`));
  return [...new Set(normalized)];
}

function validateClaimMapping(candidate: unknown) {
  if (!isRecord(candidate)) throw new Error('third_party_auth.claim_mapping must be a JSON object.');
  const mapping: Record<string, string> = {};
  for (const [key, raw] of Object.entries(candidate)) {
    if (!ALLOWED_CLAIM_KEYS.has(key)) throw new Error(`third_party_auth.claim_mapping contains unsupported claim: ${key}.`);
    mapping[key] = requiredString(raw, `third_party_auth.claim_mapping.${key}`);
  }
  for (const required of ['sub', 'role']) {
    if (!mapping[required]) throw new Error(`third_party_auth.claim_mapping.${required} is required.`);
  }
  return mapping;
}

export function extractThirdPartyAuthConfig(input: unknown): ThirdPartyAuthConfig {
  if (!isRecord(input)) throw new Error('Config must be a JSON object.');
  const hasEnvelope = Object.prototype.hasOwnProperty.call(input, 'third_party_auth');
  if (hasEnvelope) {
    const unknownEnvelopeKeys = Object.keys(input).filter(key => !['name', 'description', 'third_party_auth'].includes(key));
    if (unknownEnvelopeKeys.length > 0) throw new Error(`Config contains unknown field(s): ${unknownEnvelopeKeys.join(', ')}.`);
  }
  const candidate = hasEnvelope ? input.third_party_auth : input;
  if (!isRecord(candidate)) throw new Error('third_party_auth must be a JSON object.');
  const unknown = Object.keys(candidate).filter(key => !ALLOWED_KEYS.has(key));
  if (unknown.length > 0) throw new Error(`third_party_auth contains unknown field(s): ${unknown.join(', ')}.`);
  if (candidate.enabled !== true) throw new Error('third_party_auth.enabled must be true.');
  const mode = candidate.auth_endpoint_mode;
  if (mode !== 'local' && mode !== 'external') {
    throw new Error('third_party_auth.auth_endpoint_mode must be "local" or "external".');
  }
  const config: ThirdPartyAuthConfig = {
    enabled: true,
    issuer: validateHttpUrl(candidate.issuer, 'third_party_auth.issuer'),
    jwks_url: validateHttpUrl(candidate.jwks_url, 'third_party_auth.jwks_url'),
    audience: validateAudience(candidate.audience),
    client_id: requiredString(candidate.client_id, 'third_party_auth.client_id'),
    auth_endpoint_mode: mode,
    claim_mapping: validateClaimMapping(candidate.claim_mapping),
  };
  if (candidate.auth_upstream !== undefined) {
    config.auth_upstream = requiredString(candidate.auth_upstream, 'third_party_auth.auth_upstream');
  }
  if (candidate.auth_host_header !== undefined) {
    config.auth_host_header = requiredString(candidate.auth_host_header, 'third_party_auth.auth_host_header');
  }
  if (candidate.auth_upstream_tls_insecure_skip_verify !== undefined) {
    if (typeof candidate.auth_upstream_tls_insecure_skip_verify !== 'boolean') {
      throw new Error('third_party_auth.auth_upstream_tls_insecure_skip_verify must be a boolean.');
    }
    config.auth_upstream_tls_insecure_skip_verify = candidate.auth_upstream_tls_insecure_skip_verify;
  }
  if (mode === 'external' && !config.auth_upstream) {
    throw new Error('third_party_auth.auth_upstream is required for external auth endpoint mode.');
  }
  return config;
}

export function readThirdPartyAuthConfig(configPath: string) {
  return extractThirdPartyAuthConfig(JSON.parse(readFileSync(resolve(configPath), 'utf8')) as unknown);
}

function parseBody(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function requestJsonStage(fetchImpl: typeof fetch, stage: string, url: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...init,
      signal: init?.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`${stage} failed before receiving a response: ${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await response.text();
  const body = parseBody(text);
  if (!response.ok) throw new Error(`${stage} failed with HTTP ${response.status}.`);
  return { status: response.status, body };
}

async function loadIssuerMetadata(config: ThirdPartyAuthConfig, fetchImpl: typeof fetch) {
  const discoveryUrl = `${config.issuer}/.well-known/openid-configuration`;
  const discoveryResponse = await requestJsonStage(fetchImpl, 'OIDC discovery validation', discoveryUrl);
  if (!isRecord(discoveryResponse.body)) throw new Error('OIDC discovery response must be a JSON object.');
  const actualIssuer = requiredString(discoveryResponse.body.issuer, 'OIDC discovery issuer');
  const actualJwksUrl = requiredString(discoveryResponse.body.jwks_uri, 'OIDC discovery jwks_uri');
  if (actualIssuer.replace(/\/$/, '') !== config.issuer) throw new Error('OIDC discovery issuer does not match configured issuer.');
  if (actualJwksUrl.replace(/\/$/, '') !== config.jwks_url) throw new Error('OIDC discovery jwks_uri does not match configured jwks_url.');

  const jwksResponse = await requestJsonStage(fetchImpl, 'JWKS validation', config.jwks_url);
  if (!isRecord(jwksResponse.body) || !Array.isArray(jwksResponse.body.keys)) {
    throw new Error('JWKS response must contain a keys array.');
  }
  const signingKeys = jwksResponse.body.keys.filter((key): key is JsonObject => {
    if (!isRecord(key)) return false;
    if (key.kty === 'oct') throw new Error('JWKS must not contain symmetric oct/HS signing keys.');
    if (typeof key.alg === 'string' && key.alg.toUpperCase().startsWith('HS')) {
      throw new Error('JWKS must not contain symmetric oct/HS signing keys.');
    }
    return ['EC', 'RSA', 'OKP'].includes(String(key.kty)) && (!key.use || key.use === 'sig');
  }).map(publicSigningKey);
  if (signingKeys.length === 0) throw new Error('JWKS must contain at least one asymmetric signing key.');
  return {
    summary: {
      discovery_url: discoveryUrl,
      issuer: actualIssuer,
      jwks_url: actualJwksUrl,
      signing_key_count: signingKeys.length,
      signing_algorithms: [...new Set(signingKeys.map(key => String(key.alg || '')).filter(Boolean))],
    },
    jwtJwks: { keys: signingKeys },
  };
}

function publicSigningKey(signingKey: JsonObject) {
  const allowedMembers = ['alg', 'crv', 'e', 'ext', 'key_ops', 'kid', 'kty', 'n', 'use', 'x', 'y'];
  return Object.fromEntries(
    allowedMembers
      .filter(member => signingKey[member] !== undefined)
      .map(member => [member, signingKey[member]]),
  );
}

export async function validateIssuerMetadata(config: ThirdPartyAuthConfig, fetchImpl: typeof fetch) {
  return (await loadIssuerMetadata(config, fetchImpl)).summary;
}

function assertSubset(actual: unknown, expected: unknown, path: string) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) throw new Error(`${path} read-back mismatch.`);
    expected.forEach((expectedEntry, index) => assertSubset(actual[index], expectedEntry, `${path}[${index}]`));
    return;
  }
  if (isRecord(expected)) {
    if (!isRecord(actual)) throw new Error(`${path} read-back mismatch.`);
    for (const [key, expectedEntry] of Object.entries(expected)) assertSubset(actual[key], expectedEntry, `${path}.${key}`);
    return;
  }
  if (!Object.is(actual, expected)) throw new Error(`${path} read-back mismatch.`);
}

export async function applyThirdPartyAuth(options: ApplyThirdPartyAuthOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  if (!baseUrl) throw new Error('baseUrl is required.');
  if (!options.projectRef.trim()) throw new Error('projectRef is required.');
  const config = readThirdPartyAuthConfig(options.configPath);
  const fetchImpl = options.fetchImpl || fetch;
  const issuerMetadata = await loadIssuerMetadata(config, fetchImpl);
  const issuerValidation = issuerMetadata.summary;
  const endpoint = `${baseUrl}/v1/projects/${encodeURIComponent(options.projectRef.trim())}/config/auth`;
  const readBackEndpoint = `${baseUrl}/v1/projects/${encodeURIComponent(options.projectRef.trim())}/settings`;
  const appliedConfig = { ...config, jwt_jwks: issuerMetadata.jwtJwks };
  const payload = { third_party_auth: appliedConfig };

  if (options.dryRun) {
    const dryRunSummary = { dryRun: true, endpoint, readBackEndpoint, payload, issuerValidation, verified: true };
    if (options.outputPath) writeFileSync(resolve(options.outputPath), `${JSON.stringify(dryRunSummary, null, 2)}\n`);
    return dryRunSummary;
  }

  const token = options.token?.trim() || '';
  if (!token || /^Bearer\s/i.test(token) || token.length < 16 || /\s/.test(token)) {
    throw new Error('A token value without the Bearer prefix is required for live apply.');
  }
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const update = await requestJsonStage(fetchImpl, 'Third-party Auth update', endpoint, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(payload),
  });
  const readBack = await requestJsonStage(fetchImpl, 'Third-party Auth read-back', readBackEndpoint, { headers });
  if (!isRecord(readBack.body)) throw new Error('Third-party Auth read-back must be a JSON object.');
  const rawAuth = isRecord(readBack.body.auth)
    ? readBack.body.auth
    : isRecord(readBack.body.config) && isRecord(readBack.body.config.auth)
      ? readBack.body.config.auth
      : null;
  if (!rawAuth) throw new Error('Third-party Auth read-back did not include project auth settings.');
  assertSubset(rawAuth.third_party_auth, appliedConfig, 'third_party_auth');
  const applySummary = {
    dryRun: false,
    endpoint,
    readBackEndpoint,
    payload,
    issuerValidation,
    updateStatus: update.status,
    readBackStatus: readBack.status,
    verified: true,
  };
  if (options.outputPath) writeFileSync(resolve(options.outputPath), `${JSON.stringify(applySummary, null, 2)}\n`);
  return applySummary;
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const argumentValue = argv[index + 1];
    if (!argumentValue || argumentValue.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    args[arg.slice(2)] = argumentValue;
    index += 1;
  }
  return args;
}

if (import.meta.main) {
  const args = parseArgs(Bun.argv.slice(2));
  const applySummary = await applyThirdPartyAuth({
    baseUrl: String(args['base-url'] || process.env.SUPACLOUD_API_URL || process.env.SUPACLOUD_INTERNAL_API_URL || ''),
    projectRef: String(args['project-ref'] || process.env.SUPACLOUD_PROJECT_REF || ''),
    configPath: String(args.config || ''),
    token: String(args.token || process.env.SUPACLOUD_API_TOKEN || process.env.SUPACLOUD_MASTER_TOKEN || ''),
    dryRun: args.dryRun === true,
    outputPath: typeof args.output === 'string' ? args.output : undefined,
  });
  console.log(JSON.stringify(applySummary, null, 2));
}
