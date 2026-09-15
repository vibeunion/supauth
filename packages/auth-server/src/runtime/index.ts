// Runtime gateway — verifies GoTrue OIDC endpoints, does NOT sign tokens

import { getConfig } from '../config/index.js';
import type { Static } from '../../../shared/src/schema.js';
import { decodeUpstream } from '../utils/upstream-contract.js';
import { ApiContractError } from '../utils/api-contract.js';
import { DiscoverySchema, JWKSSchema, type RuntimeHealth } from '../../../shared/src/sdk-models.js';
export type { RuntimeHealth } from '../../../shared/src/sdk-models.js';

interface RuntimeCandidate {
  base: string;
  prefix: string;
}

interface RuntimeFetchResult<T> {
  json: T;
  candidate: RuntimeCandidate;
}

type Discovery = Static<typeof DiscoverySchema> & Record<string, unknown>;
type JWKS = Static<typeof JWKSSchema>;

function invalidRuntimeDocument(): ApiContractError {
  return new ApiContractError(502, 'invalid_upstream_response', 'Runtime document does not match its protocol contract');
}

function validateRuntimeUrl(value: string, issuer = false): void {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.hash || (issuer && url.search)) throw invalidRuntimeDocument();
  } catch {
    throw invalidRuntimeDocument();
  }
}

function decodeDiscovery(value: unknown): Discovery {
  const discovery = decodeUpstream(DiscoverySchema, value);
  validateRuntimeUrl(discovery.issuer, true);
  for (const endpoint of [
    discovery.jwks_uri, discovery.authorization_endpoint, discovery.token_endpoint,
    discovery.userinfo_endpoint, discovery.end_session_endpoint, discovery.registration_endpoint,
  ]) {
    if (endpoint !== undefined) validateRuntimeUrl(endpoint);
  }
  return discovery;
}

function decodeJWKS(value: unknown): JWKS {
  const jwks = decodeUpstream(JWKSSchema, value);
  for (const key of jwks.keys) {
    if (!key.kty.trim()) throw invalidRuntimeDocument();
  }
  return jwks;
}

function normalizeBase(base: string) {
  return base.replace(/\/$/, '');
}

function runtimeCandidates(): RuntimeCandidate[] {
  const config = getConfig();
  const candidates: RuntimeCandidate[] = [
    // Order: direct internal/runtime first, then installed public auth gateway.
    // Deduped by base+prefix so same-host dev setups only try each unique combination once.
    { base: config.oauthRuntimeInternalUrl, prefix: '' },
    { base: config.oauthRuntimeUrl, prefix: '' },
    { base: config.publicBaseUrl, prefix: '/auth/v1' },
    { base: config.oauthRuntimeUrl, prefix: '/auth/v1' },
    { base: config.oauthRuntimeInternalUrl, prefix: '/auth/v1' },
  ];

  const seen = new Set<string>();
  return candidates
    .map((candidate) => ({ base: normalizeBase(candidate.base), prefix: candidate.prefix }))
    .filter((candidate) => candidate.base)
    .filter((candidate) => {
      const key = `${candidate.base}${candidate.prefix}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function runtimeUrl(candidate: RuntimeCandidate, path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${candidate.base}${candidate.prefix}${normalizedPath}`;
}

function publicLogoutEndpoint(): string | null {
  const configured = getConfig().publicBaseUrl;
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/logout`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: string, decode: (value: unknown) => T): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`Runtime fetch failed: ${res.status}`);
  let value: unknown;
  try {
    value = await res.json();
  } catch {
    throw invalidRuntimeDocument();
  }
  return decode(value);
}

async function fetchFirstRuntimeJson<T>(path: string, decode: (value: unknown) => T): Promise<RuntimeFetchResult<T>> {
  let invalidDocument: ApiContractError | undefined;
  for (const candidate of runtimeCandidates()) {
    try {
      return { json: await fetchJson(runtimeUrl(candidate, path), decode), candidate };
    } catch (error) {
      if (error instanceof ApiContractError) invalidDocument = error;
      // Try the next runtime shape: direct GoTrue or routed /auth/v1.
    }
  }
  if (invalidDocument) throw invalidDocument;
  throw new Error('Runtime fetch failed');
}

function jwksSigningAlgorithm(jwks: JWKS | null): {
  algorithm: string | null;
  hasAlgorithms: boolean;
} {
  if (!jwks) return { algorithm: null, hasAlgorithms: false };
  const algorithms = new Set<string>();
  for (const key of jwks.keys) {
    if (key.use !== undefined && key.use !== 'sig') continue;
    if (key.alg?.trim()) algorithms.add(key.alg.trim());
  }
  return {
    algorithm: algorithms.size === 1 ? [...algorithms][0] ?? null : null,
    hasAlgorithms: algorithms.size > 0,
  };
}

function uniqueDiscoverySigningAlgorithm(discovery: Discovery): string | null {
  const algorithms = discovery.id_token_signing_alg_values_supported;
  return algorithms?.length === 1 ? algorithms[0]?.trim() || null : null;
}

export async function checkRuntimeHealth(): Promise<RuntimeHealth> {
  const health: RuntimeHealth = {
    discovery: false,
    jwks: false,
    authorize: false,
    token: false,
    userinfo: false,
    issuer: null,
    signing_alg: null,
  };

  try {
    const { json: disc, candidate } = await fetchFirstRuntimeJson('/.well-known/openid-configuration', decodeDiscovery);
    health.discovery = true;
    health.issuer = disc.issuer || null;
    let jwks: JWKS | null = null;

    try {
      jwks = await fetchJson(runtimeUrl(candidate, '/.well-known/jwks.json'), decodeJWKS);
      health.jwks = true;
    } catch {
      if (disc.jwks_uri) {
        try {
          jwks = await fetchJson(disc.jwks_uri, decodeJWKS);
          health.jwks = true;
        } catch {
          health.jwks = false;
        }
      }
    }
    const jwksAlgorithm = jwksSigningAlgorithm(jwks);
    health.signing_alg = jwksAlgorithm.hasAlgorithms
      ? jwksAlgorithm.algorithm
      : uniqueDiscoverySigningAlgorithm(disc);

    health.authorize = !!disc.authorization_endpoint;
    health.token = !!disc.token_endpoint;
    health.userinfo = !!disc.userinfo_endpoint;
  } catch {
    // runtime unreachable
  }

  return health;
}

export async function getDiscovery(): Promise<Discovery> {
  try {
    const { json: disc } = await fetchFirstRuntimeJson('/.well-known/openid-configuration', decodeDiscovery);
    const logoutEndpoint = publicLogoutEndpoint();
    if (logoutEndpoint) disc.end_session_endpoint = logoutEndpoint;
    else delete disc.end_session_endpoint;
    return disc;
  } catch (error) {
    if (error instanceof ApiContractError) throw error;
    throw new Error('Discovery fetch failed');
  }
}

export async function getJWKS(): Promise<JWKS> {
  try {
    return (await fetchFirstRuntimeJson('/.well-known/jwks.json', decodeJWKS)).json;
  } catch (error) {
    if (error instanceof ApiContractError) throw error;
    throw new Error('JWKS fetch failed');
  }
}
