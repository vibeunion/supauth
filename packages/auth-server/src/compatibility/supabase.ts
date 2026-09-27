// Supabase compatibility inspector — checks runtime against compatibility spec
// Extended with RBAC-specific checks (P1-8)

import { checkRuntimeHealth, getDiscovery } from '../runtime/index.js';
import { SupaCloudAdapter } from '../supacloud/adapter.js';
import { runRBACCompatibilityChecks } from './rbac.js';

export interface CompatibilityCheckResult {
  check_id: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: Record<string, unknown>;
}

function isSupAuthRoute(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const path = new URL(value).pathname.replace(/\/+$/, '');
    return /(?:^|\/)(?:api\/v1|functions\/v1\/supauth)(?:\/|$)/.test(path);
  } catch {
    return false;
  }
}

function checkGoTrueAuthority(discovery: Record<string, unknown>): CompatibilityCheckResult {
  const issuer = discovery['issuer'];
  const endpointNames = [
    'authorization_endpoint',
    'token_endpoint',
    'userinfo_endpoint',
    'jwks_uri',
  ] as const;
  const displacedEndpoints = endpointNames.filter((name) => isSupAuthRoute(discovery[name]));

  if (isSupAuthRoute(issuer)) {
    return {
      check_id: 'sc-5-gotrue-authority',
      status: 'fail',
      message: 'GoTrue authority is displaced: discovery issuer points at the SupAuth management Function',
      details: { issuer },
    };
  }

  if (displacedEndpoints.length > 0) {
    return {
      check_id: 'sc-5-gotrue-authority',
      status: 'fail',
      message: `GoTrue endpoints are displaced to the SupAuth management Function: ${displacedEndpoints.join(', ')}`,
      details: {
        displaced_endpoints: displacedEndpoints,
        endpoints: Object.fromEntries(endpointNames.map((name) => [name, discovery[name]])),
      },
    };
  }

  return {
    check_id: 'sc-5-gotrue-authority',
    status: 'pass',
    message: 'GoTrue remains the Supabase auth authority; SupAuth is not used as the issuer or protocol endpoint',
    details: {
      issuer,
      jwks_uri: discovery['jwks_uri'],
      runtime_mode: 'gotrue',
    },
  };
}

export async function runCompatibilityChecks(): Promise<CompatibilityCheckResult[]> {
  const results: CompatibilityCheckResult[] = [];
  // ─── SC checks (Supabase runtime compatibility) ───

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

  // SC-5: Signing and protocol authority stay on GoTrue. Catch accidental
  // gateway routing of the SupAuth management Function into /auth/v1.
  try {
    const disc = await getDiscovery();
    results.push(checkGoTrueAuthority(disc));
  } catch {
    results.push({
      check_id: 'sc-5-gotrue-authority',
      status: 'warn',
      message: 'Could not verify that GoTrue remains the protocol authority without a reachable discovery document',
    });
  }

  // SC-6: SupaCloud adapter can reach management API
  try {
    const adapter = new SupaCloudAdapter();
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
      message: `SupaCloud Management API unreachable: ${e instanceof Error ? e.message : 'Unknown upstream failure'}`,
    });
  }

  // SC-7: Discovery includes required scopes
  try {
    const disc = await getDiscovery();
    const scopesSupported = disc.scopes_supported || [];
    const requiredScopes = ['openid', 'profile', 'email', 'offline_access'];
    const missing = requiredScopes.filter(s => !scopesSupported.includes(s));
    results.push({
      check_id: 'sc-7-scopes',
      status: missing.length === 0 ? 'pass' : 'warn',
      message: missing.length === 0
        ? 'Discovery includes required scopes (openid, profile, email, offline_access)'
        : `Missing scopes in discovery: ${missing.join(', ')}`,
    });
  } catch {
    results.push({
     check_id: 'sc-7-scopes',
      status: 'warn',
      message: 'Could not check discovery scopes',
    });
  }

  // ─── RB checks (RBAC compatibility — P1-8) ───
  const rbacChecks = await runRBACCompatibilityChecks();
  results.push(...rbacChecks);

  return results;
}
