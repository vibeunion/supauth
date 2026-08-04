export const REQUIRED_AUTHORIZATION_SCENARIOS = [
  'no_membership',
  'inactive_membership',
  'cross_domain',
  'cross_application',
  'unknown_permission',
  'revoked_snapshot',
  'stale_snapshot',
  'service_user_isolation',
  'adapter_unavailable',
] as const;

export type AuthorizationScenario = typeof REQUIRED_AUTHORIZATION_SCENARIOS[number];

export interface AuthorizationObservation {
  scenario: AuthorizationScenario;
  allowed: boolean;
  status: number;
}

export interface ConformanceViolation {
  rule: string;
  message: string;
}

export interface ConformanceReport {
  passed: boolean;
  violations: readonly ConformanceViolation[];
}

export interface SqlConformanceInput {
  installSql: string;
  rlsSql: string;
}

const UNAVAILABLE_SCENARIOS = new Set<AuthorizationScenario>([
  'stale_snapshot',
  'adapter_unavailable',
]);

function expectedStatus(scenario: AuthorizationScenario): number {
  return UNAVAILABLE_SCENARIOS.has(scenario) ? 503 : 403;
}

function observationViolation(observation: AuthorizationObservation): ConformanceViolation | undefined {
  if (observation.allowed) {
    return { rule: observation.scenario, message: `${observation.scenario} must fail closed` };
  }
  const requiredStatus = expectedStatus(observation.scenario);
  if (observation.status !== requiredStatus) {
    return {
      rule: observation.scenario,
      message: `${observation.scenario} must return ${requiredStatus}, received ${observation.status}`,
    };
  }
}

export function checkAuthorizationConformance(
  observations: readonly AuthorizationObservation[],
): ConformanceReport {
  const byScenario = new Map(observations.map(observation => [observation.scenario, observation]));
  const violations: ConformanceViolation[] = [];
  if (byScenario.size !== observations.length) {
    violations.push({ rule: 'duplicate_scenario', message: 'Each authorization scenario must be observed exactly once' });
  }
  for (const scenario of REQUIRED_AUTHORIZATION_SCENARIOS) {
    const observation = byScenario.get(scenario);
    if (!observation) {
      violations.push({ rule: scenario, message: `Missing required ${scenario} observation` });
      continue;
    }
    const violation = observationViolation(observation);
    if (violation) violations.push(violation);
  }
  return Object.freeze({ passed: violations.length === 0, violations: Object.freeze(violations) });
}

interface PatternRule {
  pattern: RegExp;
  rule: string;
  message: string;
}

function requirePattern(text: string, requirement: PatternRule): ConformanceViolation | undefined {
  return requirement.pattern.test(text)
    ? undefined
    : { rule: requirement.rule, message: requirement.message };
}

function rejectPattern(text: string, rejection: PatternRule): ConformanceViolation | undefined {
  return rejection.pattern.test(text)
    ? { rule: rejection.rule, message: rejection.message }
    : undefined;
}

function executableSql(sql: string): string {
  const withoutLiterals = sql.replace(
    /'(?:''|[^'])*'|\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g,
    literal => literal.startsWith("'") ? "''" : '$$',
  );
  return withoutLiterals.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, ' ');
}

interface PolicyAuthorizationClauses {
  command?: string;
  usingClause?: string;
  checkClause?: string;
}

function policyAuthorizationClauses(policy: string): PolicyAuthorizationClauses {
  const usingBeforeCheck = policy.match(/\bUSING\s*\(([\s\S]*)\)\s+WITH\s+CHECK\s*\(/i)?.[1];
  const usingClause = usingBeforeCheck ?? policy.match(/\bUSING\s*\(([\s\S]*)\)\s*;$/i)?.[1];
  const checkClause = policy.match(/\bWITH\s+CHECK\s*\(([\s\S]*)\)\s*;$/i)?.[1];
  return { command: policy.match(/\bFOR\s+(SELECT|INSERT|UPDATE|DELETE|ALL)\b/i)?.[1]?.toUpperCase(), usingClause, checkClause };
}

function hasRequiredPolicyClauses(policy: PolicyAuthorizationClauses): boolean {
  if (policy.command === 'SELECT' || policy.command === 'DELETE') return policy.usingClause !== undefined;
  if (policy.command === 'INSERT') return policy.checkClause !== undefined;
  if (policy.command === 'UPDATE' || policy.command === 'ALL') {
    return policy.usingClause !== undefined && policy.checkClause !== undefined;
  }
  return false;
}

function policyViolations(rlsSql: string): ConformanceViolation[] {
  const policies = rlsSql.match(/CREATE\s+POLICY\b[\s\S]*?;/gi) ?? [];
  if (policies.length === 0) {
    return [{ rule: 'rls_policy', message: 'RLS SQL must contain at least one CREATE POLICY statement' }];
  }
  const violations: ConformanceViolation[] = [];
  if (policies.some(policy => !/\bTO\s+authenticated\b/i.test(policy))) {
    violations.push({ rule: 'authenticated_policy', message: 'Every authorization policy must target authenticated' });
  }
  const policyContracts = policies.map(policyAuthorizationClauses);
  const policyClauses = policyContracts.flatMap(policy => [policy.usingClause, policy.checkClause])
    .filter((clause): clause is string => clause !== undefined);
  if (policyContracts.some(policy => !hasRequiredPolicyClauses(policy))
    || policyClauses.some(clause => !/authorization_allowed_scope_ids\(/i.test(clause))) {
    violations.push({ rule: 'policy_scope_set', message: 'Every authorization policy clause must use the allowed-scope helper' });
  }
  if (policyClauses.some(clause => /^\s*TRUE\s*$/i.test(clause)
    || /\bTRUE\b\s+OR|OR\s+\bTRUE\b|\b1\s*=\s*1\b/i.test(clause))) {
    violations.push({ rule: 'permissive_policy', message: 'Authorization policies must not contain a tautological grant' });
  }
  return violations;
}

function report(candidates: Array<ConformanceViolation | undefined>): ConformanceReport {
  const violations = candidates.filter((violation): violation is ConformanceViolation => violation !== undefined);
  return Object.freeze({ passed: violations.length === 0, violations: Object.freeze(violations) });
}

function installationViolations(installSql: string): Array<ConformanceViolation | undefined> {
  return [
    requirePattern(installSql, { pattern: /LANGUAGE sql\s+STABLE\s+SECURITY DEFINER\s+SET search_path = ''/i,
      rule: 'hardened_helper', message: 'Authorization helper must be STABLE SECURITY DEFINER with an empty search_path' }),
    requirePattern(installSql, { pattern: /REVOKE ALL ON SCHEMA[^;]*FROM PUBLIC;/i,
      rule: 'revoke_schema_public', message: 'Authorization schema must revoke PUBLIC access' }),
    requirePattern(installSql, { pattern: /GRANT USAGE ON SCHEMA[^;]*TO authenticated;/i,
      rule: 'schema_usage', message: 'Authorization schema must grant authenticated usage' }),
    requirePattern(installSql, { pattern: /REVOKE ALL ON FUNCTION[^;]*authorization_allowed_scope_ids[^;]*FROM PUBLIC;/i,
      rule: 'revoke_public', message: 'Authorization helper must revoke PUBLIC' }),
    requirePattern(installSql, { pattern: /REVOKE ALL ON FUNCTION[^;]*authorization_allowed_scope_ids[^;]*FROM anon;/i,
      rule: 'revoke_anon', message: 'Authorization helper must revoke anon' }),
    requirePattern(installSql, { pattern: /GRANT EXECUTE ON FUNCTION[^;]*authorization_allowed_scope_ids[^;]*TO authenticated;/i,
      rule: 'grant_authenticated', message: 'Authorization helper must grant authenticated' }),
  ];
}

function rlsViolations(rlsSql: string): Array<ConformanceViolation | undefined> {
  return [
    requirePattern(rlsSql, { pattern: /IN\s*\(\s*SELECT\s+allowed_scope\.scope_id(?:::uuid)?/i,
      rule: 'hashed_scope_set', message: 'RLS must calculate allowed scope IDs through an uncorrelated IN subplan' }),
    rejectPattern(rlsSql, { pattern: /has_org_permission\(/i, rule: 'row_permission_helper',
      message: 'RLS must not call a row-scoped organization permission helper' }),
    rejectPattern(rlsSql, { pattern: /authorization_allowed_scope_ids\([^)]*"[a-z_][a-z0-9_]*"/i,
      rule: 'row_scope_argument', message: 'RLS must not pass a row column to the allowed-scope helper' }),
    rejectPattern(rlsSql, { pattern: /"[a-z_][a-z0-9_]*"::text\s*=\s*ANY|array_agg\(/i,
      rule: 'row_cast_scope_array', message: 'RLS must not cast the row column or use a per-row ANY scope array' }),
    ...policyViolations(rlsSql),
  ];
}

export function checkAuthorizationSql(input: SqlConformanceInput): ConformanceReport {
  const installSql = executableSql(input.installSql);
  const rlsSql = executableSql(input.rlsSql);
  return report([...installationViolations(installSql), ...rlsViolations(rlsSql)]);
}

export function checkAuthorizationExplain(planText: string): ConformanceReport {
  const planLines = planText.split(/\r?\n/);
  const helperExecutionBlocks = planLines.flatMap((line, index) => {
    if (!/authorization_allowed_scope_ids|has_org_permission/i.test(line)) return [];
    return [`${line} ${planLines[index + 1] ?? ''}`];
  }).filter(block => /\bloops=\d+\b/i.test(block));
  return report([
    requirePattern(planText, { pattern: /InitPlan|hashed SubPlan|Hash Semi Join/i, rule: 'one_time_scope_plan',
      message: 'EXPLAIN must show an InitPlan, hashed SubPlan, or hash semi join for allowed scopes' }),
    helperExecutionBlocks.some(block => /\bloops=1\b/i.test(block))
      ? undefined
      : { rule: 'one_time_execution', message: 'The authorization helper plan node must execute once' },
    helperExecutionBlocks.some(block => !/\bloops=1\b/i.test(block))
      ? { rule: 'row_helper_execution', message: 'Authorization helper plan nodes must not execute per target row' }
      : undefined,
  ]);
}
