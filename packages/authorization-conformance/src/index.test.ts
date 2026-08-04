import { describe, expect, it } from 'bun:test';
import {
  checkAuthorizationConformance,
  checkAuthorizationExplain,
  checkAuthorizationSql,
  REQUIRED_AUTHORIZATION_SCENARIOS,
  type AuthorizationObservation,
} from './index.js';

function passingObservations(): AuthorizationObservation[] {
  return REQUIRED_AUTHORIZATION_SCENARIOS.map(scenario => ({
    scenario,
    allowed: false,
    status: scenario === 'stale_snapshot' || scenario === 'adapter_unavailable' ? 503 : 403,
  }));
}

describe('@supauth/authorization-conformance', () => {
  it('requires every denial and availability scenario with distinct statuses', () => {
    expect(checkAuthorizationConformance(passingObservations())).toEqual({ passed: true, violations: [] });

    const incomplete = passingObservations().filter(observation => observation.scenario !== 'cross_domain');
    incomplete.find(observation => observation.scenario === 'adapter_unavailable')!.status = 403;
    const report = checkAuthorizationConformance(incomplete);
    expect(report.passed).toBe(false);
    expect(report.violations.map(violation => violation.rule)).toEqual(['cross_domain', 'adapter_unavailable']);
  });

  it('rejects accidental allow results for revoked or isolated principals', () => {
    const observations = passingObservations();
    observations.find(observation => observation.scenario === 'revoked_snapshot')!.allowed = true;
    observations.find(observation => observation.scenario === 'service_user_isolation')!.allowed = true;
    expect(checkAuthorizationConformance(observations).violations).toHaveLength(2);
  });

  it('reports duplicate observations instead of silently replacing them', () => {
    const observations = passingObservations();
    observations.push({ ...observations[0] });
    expect(checkAuthorizationConformance(observations).violations[0].rule).toBe('duplicate_scenario');
  });

  it('checks SQL hardening and one-time scope-set invariants', () => {
    const report = checkAuthorizationSql({
      installSql: `LANGUAGE sql\nSTABLE\nSECURITY DEFINER\nSET search_path = ''\nREVOKE ALL ON SCHEMA authz FROM PUBLIC;\nGRANT USAGE ON SCHEMA authz TO authenticated;\nREVOKE ALL ON FUNCTION authorization_allowed_scope_ids(TEXT) FROM PUBLIC;\nREVOKE ALL ON FUNCTION authorization_allowed_scope_ids(TEXT) FROM anon;\nGRANT EXECUTE ON FUNCTION authorization_allowed_scope_ids(TEXT) TO authenticated;`,
      rlsSql: `CREATE POLICY invoice_read ON invoices FOR SELECT TO authenticated USING (organization_id IN (\nSELECT allowed_scope.scope_id::uuid\nFROM authorization_allowed_scope_ids('invoice:read', 'organization', 'xigu-fa') AS allowed_scope));`,
    });
    expect(report).toEqual({ passed: true, violations: [] });

    const unsafe = checkAuthorizationSql({
      installSql: 'SECURITY DEFINER',
      rlsSql: `has_org_permission("organization_id", 'invoice:read')`,
    });
    expect(unsafe.passed).toBe(false);
    expect(unsafe.violations.map(violation => violation.rule)).toContain('row_permission_helper');
  });

  it('does not accept safety keywords hidden in comments or string literals', () => {
    const report = checkAuthorizationSql({
      installSql: `-- LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''\nSELECT 'REVOKE ALL ON FUNCTION authorization_allowed_scope_ids(TEXT) FROM PUBLIC;';`,
      rlsSql: `/* authorization_allowed_scope_ids('invoice:read') */\nCREATE POLICY open_access ON invoices FOR SELECT TO authenticated USING (true);`,
    });
    expect(report.passed).toBe(false);
    expect(report.violations.map(violation => violation.rule)).toContain('hardened_helper');
    expect(report.violations.map(violation => violation.rule)).toContain('policy_scope_set');
  });

  it('checks USING and WITH CHECK independently', () => {
    const report = checkAuthorizationSql({
      installSql: `LANGUAGE sql\nSTABLE\nSECURITY DEFINER\nSET search_path = ''\nREVOKE ALL ON SCHEMA authz FROM PUBLIC;\nGRANT USAGE ON SCHEMA authz TO authenticated;\nREVOKE ALL ON FUNCTION authorization_allowed_scope_ids(TEXT) FROM PUBLIC;\nREVOKE ALL ON FUNCTION authorization_allowed_scope_ids(TEXT) FROM anon;\nGRANT EXECUTE ON FUNCTION authorization_allowed_scope_ids(TEXT) TO authenticated;`,
      rlsSql: `CREATE POLICY invoice_update ON invoices FOR UPDATE TO authenticated USING (true) WITH CHECK (organization_id IN (SELECT allowed_scope.scope_id::uuid FROM authorization_allowed_scope_ids('invoice:update', 'organization', 'xigu-fa') AS allowed_scope));`,
    });
    expect(report.passed).toBe(false);
    expect(report.violations.map(violation => violation.rule)).toContain('policy_scope_set');
    expect(report.violations.map(violation => violation.rule)).toContain('permissive_policy');
  });

  it('requires command-specific policy clauses', () => {
    const installSql = `LANGUAGE sql\nSTABLE\nSECURITY DEFINER\nSET search_path = ''\nREVOKE ALL ON SCHEMA authz FROM PUBLIC;\nGRANT USAGE ON SCHEMA authz TO authenticated;\nREVOKE ALL ON FUNCTION authorization_allowed_scope_ids(TEXT) FROM PUBLIC;\nREVOKE ALL ON FUNCTION authorization_allowed_scope_ids(TEXT) FROM anon;\nGRANT EXECUTE ON FUNCTION authorization_allowed_scope_ids(TEXT) TO authenticated;`;
    const scopePredicate = `organization_id IN (SELECT allowed_scope.scope_id::uuid FROM authorization_allowed_scope_ids('invoice:update', 'organization', 'xigu-fa') AS allowed_scope)`;
    for (const rlsSql of [
      `CREATE POLICY missing_using ON invoices FOR UPDATE TO authenticated WITH CHECK (${scopePredicate});`,
      `CREATE POLICY missing_check ON invoices FOR UPDATE TO authenticated USING (${scopePredicate});`,
    ]) {
      const report = checkAuthorizationSql({ installSql, rlsSql });
      expect(report.passed).toBe(false);
      expect(report.violations.map(violation => violation.rule)).toContain('policy_scope_set');
    }
  });

  it('requires real one-time execution evidence from authenticated EXPLAIN', () => {
    expect(checkAuthorizationExplain(
      'Hash Semi Join  (actual time=0.1..0.2 rows=4 loops=1)\n  InitPlan 1 (returns $0)\n    Function Scan on authorization_allowed_scope_ids (actual rows=4 loops=1)',
    ).passed).toBe(true);
    expect(checkAuthorizationExplain(
      'Seq Scan\n  Function Scan on authorization_allowed_scope_ids (actual rows=1 loops=250000)',
    ).violations.map(violation => violation.rule)).toEqual([
      'one_time_scope_plan',
      'one_time_execution',
      'row_helper_execution',
    ]);
    expect(checkAuthorizationExplain(
      'Hash Semi Join (actual rows=4 loops=1)\nFunction Scan on authorization_allowed_scope_ids\n(actual rows=1 loops=250000)',
    ).passed).toBe(false);
    expect(checkAuthorizationExplain(
      'Hash Semi Join (actual rows=4 loops=1)\nFunction Scan on authorization_allowed_scope_ids (actual rows=1 loops=1)\nFunction Scan on authorization_allowed_scope_ids\n(actual rows=1 loops=250000)',
    ).violations.map(violation => violation.rule)).toContain('row_helper_execution');
  });
});
