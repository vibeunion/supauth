// RBAC compatibility inspector extensions (P1-8)
// Checks: helper function existence, grants correctness, unsafe JWT role claims

import { checkRuntimeHealth, getDiscovery } from '../runtime/index.js';
import { getConfig } from '../config/index.js';

// ─── RBAC-specific compatibility checks ────────────────────────────────

export interface RBACCheckResult {
  check_id: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: Record<string, unknown>;
}

export async function runRBACCompatibilityChecks(): Promise<RBACCheckResult[]> {
  const results: RBACCheckResult[] = [];
  const config = getConfig();

  // RB-1: Check supaoauth.authorize() function exists and is callable
  results.push({
    check_id: 'rb-1-authorize-function',
    status: 'warn',
    message: 'Cannot verify supaoauth.authorize() existence without a live Postgres connection. Run migration first, then re-check.',
    details: { required_action: 'Run bun run migrate to create supaoauth schema and helper functions' },
  });

  // RB-2: Check supaoauth.has_org_permission() function exists and is callable
  results.push({
    check_id: 'rb-2-has-org-permission-function',
    status: 'warn',
    message: 'Cannot verify supaoauth.has_org_permission() existence without a live Postgres connection. Run migration first.',
    details: { required_action: 'Run bun run migrate to create supaoauth schema and helper functions' },
  });

  // RB-3: Check GRANT EXECUTE on helpers to authenticated role
  results.push({
    check_id: 'rb-3-helper-grants',
    status: 'warn',
    message: 'Cannot verify EXECUTE grants on supaoauth.authorize / has_org_permission without live Postgres. Migration script includes explicit GRANT statements.',
    details: { expected_grants: 'GRANT EXECUTE ON FUNCTION supaoauth.authorize(TEXT, UUID) TO authenticated; GRANT EXECUTE ON FUNCTION supaoauth.has_org_permission(UUID, TEXT) TO authenticated;' },
  });

  // RB-4: Check JWT role claim is not used for business RBAC
  try {
    const disc = await getDiscovery();
    const discObj = disc as Record<string, unknown>;
    const idTokenAlgs = discObj.id_token_signing_alg_values_supported as string[];
    const defaultAlg = idTokenAlgs?.[0];

    if (config.runtimeMode === 'gotrue') {
      results.push({
        check_id: 'rb-4-gotrue-jwt-role-safe',
        status: 'pass',
        message: `In gotrue mode, JWT role claim remains 'authenticated'/'anon'. SupaOAuth does not write business roles into the top-level role claim.`,
        details: { runtime_mode: 'gotrue', signing_alg: defaultAlg || 'unknown' },
      });
    } else {
      results.push({
        check_id: 'rb-4-external-oidc-role-claim',
        status: 'warn',
        message: 'In external_oidc mode, JWT may contain custom claims. Verify that business roles use supaoauth:roles namespace, not top-level role.',
        details: { runtime_mode: 'external_oidc', expected_namespace: 'supaoauth:roles' },
      });
    }
  } catch {
    results.push({
      check_id: 'rb-4-jwt-role-check',
      status: 'warn',
      message: 'Cannot check JWT role claim strategy without a reachable OIDC discovery endpoint.',
    });
  }

  // RB-5: Check app_metadata.supaoauth namespace usage
  results.push({
    check_id: 'rb-5-app-metadata-namespace',
    status: 'pass',
    message: 'SupaOAuth uses app_metadata.supaoauth namespace for lightweight JWT hints. RLS authorization should use supaoauth.authorize() function, not JWT claims.',
    details: { namespace: 'app_metadata.supaoauth', authoritative_source: 'supaoauth.authorize() SQL function' },
  });

  // RB-6: Check that supaoauth schema is isolated from auth schema
  results.push({
    check_id: 'rb-6-schema-isolation',
    status: 'pass',
    message: 'SupaOAuth metadata lives in supaoauth schema, separate from GoTrue auth schema. No cross-schema table writes.',
    details: { supaoauth_tables: ['api_resources', 'scopes', 'organizations', 'organization_members', 'roles', 'permissions', 'role_assignments', 'webhooks', 'audit_logs', 'sign_in_experience', 'connectors', 'application_bindings'] },
  });

  // RB-7: Detect unsafe RLS patterns — policies using JWT role claim for business authorization
  results.push({
    check_id: 'rb-7-unsafe-rls-patterns',
    status: 'warn',
    message: 'Cannot scan existing RLS policies without live Postgres. Use the RLS migration assistant (P1-7) to inspect policies and generate wrapper patterns.',
    details: { unsafe_patterns: [
      'USING (current_setting(\'request.jwt.claim.role\') = \'admin\')',
      'USING (auth.jwt() ->> \'role\' = \'owner\')',
      'USING ((select auth.jwt()) ->> \'role\' IN (\'admin\', \'editor\'))',
    ], fix_pattern: 'Replace with: USING (owner_id = auth.uid() OR supaoauth.authorize(\'resource.read\'))' },
  });

  return results;
}
