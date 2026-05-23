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

export async function checkRuntimeHealth(): Promise<RuntimeHealth> {
  const config = getConfig();
  const base = config.oauthRuntimeUrl;

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
    const discRes = await fetch(`${base}/auth/v1/.well-known/openid-configuration`);
    if (discRes.ok) {
      health.discovery = true;
      const disc = await discRes.json() as Record<string, unknown>;
      health.issuer = (disc.issuer as string) || null;
      const signingAlgs = disc.id_token_signing_alg_values_supported;
      health.signing_alg = Array.isArray(signingAlgs) && signingAlgs.length > 0
        ? String(signingAlgs[0])
        : null;

      if (disc.jwks_uri) {
        const jwksRes = await fetch(disc.jwks_uri as string);
        health.jwks = jwksRes.ok;
      }
      health.authorize = !!disc.authorization_endpoint;
      health.token = !!disc.token_endpoint;
      health.userinfo = !!disc.userinfo_endpoint;
    }
  } catch {
    // runtime unreachable
  }

  return health;
}

export async function getDiscovery(): Promise<Record<string, unknown>> {
  const config = getConfig();
  const res = await fetch(`${config.oauthRuntimeUrl}/auth/v1/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`Discovery fetch failed: ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

export async function getJWKS(): Promise<Record<string, unknown>> {
  const config = getConfig();
  const res = await fetch(`${config.oauthRuntimeUrl}/auth/v1/.well-known/jwks.json`);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}
