// Runtime gateway — verifies GoTrue OIDC endpoints, does NOT sign tokens

import { getConfig } from '../config/index.js';

export interface RuntimeHealth {
  discovery: boolean;
  jwks: boolean;
  authorize: boolean;
  token: boolean;
  userinfo: boolean;
  issuer: string | null;
  signing_alg: string | null;
}

interface RuntimeCandidate {
  base: string;
  prefix: string;
}

interface RuntimeFetchResult {
  json: Record<string, unknown>;
  candidate: RuntimeCandidate;
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

async function fetchJson(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`Runtime fetch failed: ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

async function fetchFirstRuntimeJson(path: string): Promise<RuntimeFetchResult> {
  for (const candidate of runtimeCandidates()) {
    try {
      return { json: await fetchJson(runtimeUrl(candidate, path)), candidate };
    } catch {
      // Try the next runtime shape: direct GoTrue or routed /auth/v1.
    }
  }
  throw new Error('Runtime fetch failed');
}

function jwksSigningAlgorithm(jwks: Record<string, unknown> | null): {
  algorithm: string | null;
  hasAlgorithms: boolean;
} {
  if (!jwks || !Array.isArray(jwks.keys)) return { algorithm: null, hasAlgorithms: false };
  const algorithms = new Set<string>();
  for (const candidate of jwks.keys) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const key = candidate as Record<string, unknown>;
    if (key.use !== undefined && key.use !== 'sig') continue;
    if (typeof key.alg === 'string' && key.alg.trim()) algorithms.add(key.alg.trim());
  }
  return {
    algorithm: algorithms.size === 1 ? [...algorithms][0] : null,
    hasAlgorithms: algorithms.size > 0,
  };
}

function uniqueDiscoverySigningAlgorithm(discovery: Record<string, unknown>): string | null {
  const algorithms = discovery.id_token_signing_alg_values_supported;
  return Array.isArray(algorithms)
    && algorithms.length === 1
    && typeof algorithms[0] === 'string'
    && algorithms[0].trim()
    ? algorithms[0].trim()
    : null;
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
    const { json: disc, candidate } = await fetchFirstRuntimeJson('/.well-known/openid-configuration');
    health.discovery = true;
    health.issuer = (disc.issuer as string) || null;
    let jwks: Record<string, unknown> | null = null;

    try {
      jwks = await fetchJson(runtimeUrl(candidate, '/.well-known/jwks.json'));
      health.jwks = true;
    } catch {
      if (disc.jwks_uri) {
        try {
          jwks = await fetchJson(disc.jwks_uri as string);
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

export async function getDiscovery(): Promise<Record<string, unknown>> {
  try {
    const { json: disc } = await fetchFirstRuntimeJson('/.well-known/openid-configuration');
    const logoutEndpoint = publicLogoutEndpoint();
    if (logoutEndpoint) disc.end_session_endpoint = logoutEndpoint;
    else delete disc.end_session_endpoint;
    return disc;
  } catch {
    throw new Error('Discovery fetch failed');
  }
}

export async function getJWKS(): Promise<Record<string, unknown>> {
  try {
    return (await fetchFirstRuntimeJson('/.well-known/jwks.json')).json;
  } catch {
    throw new Error('JWKS fetch failed');
  }
}
