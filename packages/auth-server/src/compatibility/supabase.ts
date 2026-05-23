// Supabase compatibility inspector — checks runtime against compatibility spec

import { checkRuntimeHealth, getDiscovery } from '../runtime/index.js';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import { getConfig } from '../config/index.js';

interface CompatibilityCheckResult {
  check_id: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: Record<string, unknown>;
}

export async function runCompatibilityChecks(): Promise<CompatibilityCheckResult[]> {
  const results: CompatibilityCheckResult[] = [];
  const config = getConfig();

  // SC-1: Discovery endpoint reachable
  const health = await checkRuntimeHealth();
  results.push({
    check_id: 'sc-1-discovery',
    status: health.discovery ? 'pass' : 'fail',
    message: health.discovery
      ? 'OIDC discovery document is reachable'
      : 'OIDC discovery document is not reachable',
  });

  // SC-2: JWKS endpoint reachable
  results.push({
    check_id: 'sc-2-jwks',
    status: health.jwks ? 'pass' : 'fail',
    message: health.jwks
      ? 'JWKS endpoint is reachable and returns valid keys'
      : 'JWKS endpoint is not reachable',
  });

  // SC-3: Authorization and token endpoints exist
  results.push({
    check_id: 'sc-3-auth-endpoints',
    status: health.authorize && health.token ? 'pass' : 'fail',
    message: health.authorize && health.token
      ? 'Authorization and token endpoints are present in discovery'
      : 'Missing authorization or token endpoint in discovery',
  });

  // SC-4: Issuer present
  results.push({
    check_id: 'sc-4-issuer',
    status: health.issuer ? 'pass' : 'warn',
    message: health.issuer
      ? `Issuer: ${health.issuer}`
      : 'Issuer not found in discovery document',
  });

  // SC-5: Signing algorithm is asymmetric in external_oidc mode
  if (config.runtimeMode === 'external_oidc') {
    const asymmetricAlgs = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512', 'PS256', 'PS384', 'PS512'];
    results.push({
      check_id: 'sc-5-external-oidc-signing',
      status: health.signing_alg && asymmetricAlgs.includes(health.signing_alg) ? 'pass' : 'fail',
      message: health.signing_alg && asymmetricAlgs.includes(health.signing_alg)
        ? `External OIDC mode uses asymmetric signing: ${health.signing_alg}`
        : `External OIDC mode requires asymmetric signing, got: ${health.signing_alg || 'unknown'}`,
    });
  }

  // SC-6: SupaCloud adapter can reach management API
  try {
    const adapter = getSupaCloudAdapter();
    await adapter.getAuthConfig();
    results.push({
      check_id: 'sc-6-supacloud-reachable',
      status: 'pass',
      message: 'SupaCloud Management API is reachable',
    });
  } catch (e) {
    results.push({
      check_id: 'sc-6-supacloud-reachable',
      status: 'fail',
      message: `SupaCloud Management API unreachable: ${(e as Error).message}`,
    });
  }

  // SC-7: Discovery includes required scopes
  try {
    const disc = await getDiscovery();
    const scopesSupported = (disc.scopes_supported as string[]) || [];
    const requiredScopes = ['openid', 'profile', 'email'];
    const missing = requiredScopes.filter(s => !scopesSupported.includes(s));
    results.push({
      check_id: 'sc-7-scopes',
      status: missing.length === 0 ? 'pass' : 'warn',
      message: missing.length === 0
        ? 'Discovery includes required scopes (openid, profile, email)'
        : `Missing scopes in discovery: ${missing.join(', ')}`,
    });
  } catch {
    results.push({
      check_id: 'sc-7-scopes',
      status: 'warn',
      message: 'Could not check discovery scopes',
    });
  }

  return results;
}
