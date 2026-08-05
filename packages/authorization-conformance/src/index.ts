export const REQUIRED_AUTHORIZATION_DENIAL_SCENARIOS = [
  'no_membership',
  'inactive_principal',
  'inactive_membership',
  'revoked_membership',
  'ambiguous_membership',
  'explicit_deny_precedence',
  'cross_issuer',
  'cross_subject',
  'cross_domain',
  'cross_application',
  'unknown_permission',
  'service_user_isolation',
  'adapter_unavailable',
] as const;

export const REQUIRED_AUTHORIZATION_SCENARIOS = [
  ...REQUIRED_AUTHORIZATION_DENIAL_SCENARIOS,
  'revocation_visibility',
] as const;

export type AuthorizationDenialScenario = typeof REQUIRED_AUTHORIZATION_DENIAL_SCENARIOS[number];
export type AuthorizationScenario = typeof REQUIRED_AUTHORIZATION_SCENARIOS[number];

export interface AuthorizationOutcome {
  readonly allowed: boolean;
  readonly status: number;
}

export interface RevocationVisibilityOutcome {
  readonly before: AuthorizationOutcome;
  readonly after: AuthorizationOutcome;
}

export interface AuthorizationConformanceHarness {
  runDenialScenario(scenario: AuthorizationDenialScenario): Promise<AuthorizationOutcome>;
  runRevocationVisibilityScenario(): Promise<RevocationVisibilityOutcome>;
}

export interface ConformanceViolation {
  readonly rule: string;
  readonly message: string;
}

export interface ConformanceReport {
  readonly passed: boolean;
  readonly violations: readonly ConformanceViolation[];
}

export interface SqlConformanceInput {
  readonly installSql: string;
  readonly projectionPreflightSql: string;
  readonly rlsSql: string;
  readonly legacyCleanupSql?: string;
}

const UNAVAILABLE_SCENARIOS = new Set<AuthorizationDenialScenario>(['adapter_unavailable']);

interface PatternRule {
  pattern: RegExp;
  rule: string;
  message: string;
}

interface PolicyAuthorizationClauses {
  command?: string;
  usingClause?: string;
  checkClause?: string;
}

type ExplainNode = Record<string, unknown>;

interface ExplainEntry {
  node: ExplainNode;
  ancestors: readonly ExplainNode[];
}

interface SqlSegment {
  normalized: string;
  nextOffset: number;
}

function report(violations: readonly ConformanceViolation[]): ConformanceReport {
  return Object.freeze({ passed: violations.length === 0, violations: Object.freeze([...violations]) });
}

function expectedStatus(scenario: AuthorizationDenialScenario): number {
  return UNAVAILABLE_SCENARIOS.has(scenario) ? 503 : 403;
}

function outcomeViolation(
  rule: AuthorizationScenario,
  outcome: AuthorizationOutcome,
  expectedAllowed: boolean,
  requiredStatus: number,
): ConformanceViolation | undefined {
  if (!outcome || typeof outcome.allowed !== 'boolean' || !Number.isInteger(outcome.status)) {
    return { rule, message: `${rule} returned an invalid outcome` };
  }
  if (outcome.allowed !== expectedAllowed) {
    return { rule, message: `${rule} must ${expectedAllowed ? 'allow before revocation' : 'fail closed'}` };
  }
  return outcome.status === requiredStatus
    ? undefined
    : { rule, message: `${rule} must return ${requiredStatus}, received ${outcome.status}` };
}

async function denialScenarioViolations(
  harness: AuthorizationConformanceHarness,
): Promise<ConformanceViolation[]> {
  const violations: ConformanceViolation[] = [];
  for (const scenario of REQUIRED_AUTHORIZATION_DENIAL_SCENARIOS) {
    try {
      const violation = outcomeViolation(
        scenario,
        await harness.runDenialScenario(scenario),
        false,
        expectedStatus(scenario),
      );
      if (violation) violations.push(violation);
    } catch {
      violations.push({ rule: scenario, message: `${scenario} runner failed before producing an authorization outcome` });
    }
  }
  return violations;
}

async function revocationVisibilityViolation(
  harness: AuthorizationConformanceHarness,
): Promise<ConformanceViolation | undefined> {
  const rule = 'revocation_visibility';
  try {
    const transition = await harness.runRevocationVisibilityScenario();
    return outcomeViolation(rule, transition?.before, true, 200)
      ?? outcomeViolation(rule, transition?.after, false, 403);
  } catch {
    return { rule, message: `${rule} runner failed before producing an authorization transition` };
  }
}

export async function runAuthorizationConformance(
  harness: AuthorizationConformanceHarness,
): Promise<ConformanceReport> {
  const violations = await denialScenarioViolations(harness);
  const revocationViolation = await revocationVisibilityViolation(harness);
  if (revocationViolation) violations.push(revocationViolation);
  return report(violations);
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

function dollarQuoteAt(sql: string, offset: number): string | undefined {
  return sql.slice(offset).match(/^\$(?:[a-z_][a-z0-9_]*)?\$/i)?.[0];
}

function quotedStringEnd(sql: string, offset: number): number {
  let cursor = offset + 1;
  while (cursor < sql.length) {
    if (sql[cursor] !== "'") {
      cursor += 1;
      continue;
    }
    if (sql[cursor + 1] === "'") {
      cursor += 2;
      continue;
    }
    return cursor + 1;
  }
  return sql.length;
}

function commentEnd(sql: string, offset: number): number | undefined {
  if (sql.startsWith('--', offset)) {
    const newline = sql.indexOf('\n', offset + 2);
    return newline < 0 ? sql.length : newline;
  }
  if (!sql.startsWith('/*', offset)) return undefined;
  const closing = sql.indexOf('*/', offset + 2);
  return closing < 0 ? sql.length : closing + 2;
}

function dollarQuotedSegment(sql: string, offset: number, prefix: string): SqlSegment | undefined {
  const tag = dollarQuoteAt(sql, offset);
  if (!tag) return undefined;
  const bodyStart = offset + tag.length;
  const bodyEnd = sql.indexOf(tag, bodyStart);
  if (bodyEnd < 0) return { normalized: '', nextOffset: sql.length };
  const body = sql.slice(bodyStart, bodyEnd);
  return {
    normalized: /\b(?:AS|DO)\s*$/i.test(prefix) ? `${tag}${executableSql(body)}${tag}` : "''",
    nextOffset: bodyEnd + tag.length,
  };
}

function nextSqlSegment(sql: string, offset: number, prefix: string): SqlSegment {
  const commentClosing = commentEnd(sql, offset);
  if (commentClosing !== undefined) return { normalized: ' ', nextOffset: commentClosing };
  if (sql[offset] === "'") return { normalized: "''", nextOffset: quotedStringEnd(sql, offset) };
  return dollarQuotedSegment(sql, offset, prefix)
    ?? { normalized: sql[offset]!, nextOffset: offset + 1 };
}

function executableSql(sql: string): string {
  let normalized = '';
  let offset = 0;
  while (offset < sql.length) {
    const segment = nextSqlSegment(sql, offset, normalized);
    normalized += segment.normalized;
    offset = segment.nextOffset;
  }
  return normalized;
}

function policyAuthorizationClauses(policy: string): PolicyAuthorizationClauses {
  const usingBeforeCheck = policy.match(/\bUSING\s*\(([\s\S]*)\)\s+WITH\s+CHECK\s*\(/i)?.[1];
  const usingClause = usingBeforeCheck ?? policy.match(/\bUSING\s*\(([\s\S]*)\)\s*;$/i)?.[1];
  const checkClause = policy.match(/\bWITH\s+CHECK\s*\(([\s\S]*)\)\s*;$/i)?.[1];
  return {
    command: policy.match(/\bFOR\s+(SELECT|INSERT|UPDATE|DELETE|ALL)\b/i)?.[1]?.toUpperCase(),
    usingClause,
    checkClause,
  };
}

function hasRequiredPolicyClauses(policy: PolicyAuthorizationClauses): boolean {
  if (policy.command === 'SELECT' || policy.command === 'DELETE') return policy.usingClause !== undefined;
  if (policy.command === 'INSERT') return policy.checkClause !== undefined;
  if (policy.command === 'UPDATE') return policy.usingClause !== undefined && policy.checkClause !== undefined;
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
  const clauses = policyContracts.flatMap(policy => [policy.usingClause, policy.checkClause])
    .filter((clause): clause is string => clause !== undefined);
  if (policyContracts.some(policy => !hasRequiredPolicyClauses(policy))
    || clauses.some(clause => !/authorization_allowed_scope_ids\(/i.test(clause))) {
    violations.push({ rule: 'policy_scope_set', message: 'Every authorization policy clause must use the allowed-scope helper' });
  }
  if (clauses.some(clause => /^\s*TRUE\s*$/i.test(clause)
    || /\bTRUE\b\s+OR|OR\s+\bTRUE\b|\b1\s*=\s*1\b/i.test(clause))) {
    violations.push({ rule: 'permissive_policy', message: 'Authorization policies must not contain a tautological grant' });
  }
  return violations;
}

const TOP_LEVEL_DO_PATTERN = /(?:^|;)\s*DO\b/i;
const SQL_MUTATION_PATTERN = /\b(?:INSERT|UPDATE|DELETE|MERGE|UPSERT|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COMMENT|REINDEX|VACUUM|ANALYZE|REFRESH|CALL|DO|COPY|SET|RESET|LOCK)\b/i;
const PROJECTION_PREFLIGHT_REQUIREMENTS: readonly PatternRule[] = [
  { pattern: /pg_catalog\.to_regclass\(/i,
    rule: 'catalog_resolution', message: 'Projection preflight must resolve the view through pg_catalog' },
  { pattern: /relation_oid\s+IS\s+NULL/i,
    rule: 'projection_presence', message: 'Projection preflight must report a missing view' },
  { pattern: /relkind[\s\S]{0,200}IS DISTINCT FROM\s*''/i,
    rule: 'ordinary_projection', message: 'Projection preflight must require an ordinary view' },
  { pattern: /ARRAY\s*\(\s*SELECT[\s\S]*attname[\s\S]*pg_attribute/i,
    rule: 'projection_columns', message: 'Projection preflight must validate the exact column contract' },
  { pattern: /atttypid[\s\S]{0,100}pg_catalog\.regtype/i,
    rule: 'projection_column_types', message: 'Projection preflight must require TEXT columns' },
  { pattern: /has_table_privilege\([\s\S]*has_table_privilege\(/i,
    rule: 'projection_privileges', message: 'Projection preflight must check both API roles for direct access' },
  { pattern: /violations\s*\(\s*rule\s*,\s*message\s*\)[\s\S]*SELECT\s+rule\s*,\s*message\s+FROM\s+violations/i,
    rule: 'projection_preflight_result', message: 'Projection preflight must return machine-readable rule and message rows' },
];
const PROJECTION_PREFLIGHT_REJECTIONS: readonly PatternRule[] = [
  { pattern: SQL_MUTATION_PATTERN,
    rule: 'projection_preflight_read_only', message: 'Projection preflight must be one read-only query' },
  { pattern: /;\s*\S/i,
    rule: 'projection_preflight_statement', message: 'Projection preflight must contain exactly one statement' },
];

function projectionPreflightViolations(preflightSql: string): Array<ConformanceViolation | undefined> {
  return [
    ...PROJECTION_PREFLIGHT_REQUIREMENTS.map(requirement => requirePattern(preflightSql, requirement)),
    ...PROJECTION_PREFLIGHT_REJECTIONS.map(rejection => rejectPattern(preflightSql, rejection)),
  ];
}

function installationViolations(installSql: string): Array<ConformanceViolation | undefined> {
  return [
    requirePattern(installSql, { pattern: /permission_grant\.application_id\s*=\s*''/i,
      rule: 'fixed_application', message: 'Authorization helper must bind a fixed application ID' }),
    requirePattern(installSql, { pattern: /authorization_allowed_scope_ids\(\s*requested_permission TEXT,\s*requested_domain_type TEXT\s*\)/i,
      rule: 'fixed_application_helper', message: 'Authorization helper must expose only permission and domain parameters' }),
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
    rejectPattern(installSql, { pattern: /CREATE\s+TABLE[^;]*(?:permission_catalog|role_permissions)/i,
      rule: 'package_owned_policy', message: 'Authorization SQL must not create package-owned permission facts' }),
    rejectPattern(installSql, { pattern: /active_memberships|active_role_assignments|requested_application_id/i,
      rule: 'legacy_adapter', message: 'Authorization SQL must not use the legacy role adapter or caller application parameter' }),
    rejectPattern(installSql, { pattern: TOP_LEVEL_DO_PATTERN,
      rule: 'install_static_sql', message: 'Authorization installation must not contain top-level procedural SQL' }),
    rejectPattern(installSql, { pattern: /pg_catalog\.to_regclass\(|pg_catalog\.pg_attribute|has_table_privilege\(/i,
      rule: 'projection_preflight_separation', message: 'Projection catalog checks must remain separate from installation SQL' }),
  ];
}

function rlsViolations(rlsSql: string): Array<ConformanceViolation | undefined> {
  return [
    requirePattern(rlsSql, { pattern: /IN\s*\(\s*SELECT\s+allowed_scope\.scope_id(?:::uuid)?/i,
      rule: 'hashed_scope_set', message: 'RLS must calculate allowed scope IDs through an uncorrelated IN subplan' }),
    rejectPattern(rlsSql, { pattern: /authorization_allowed_scope_ids\(\s*[^,()]+\s*,\s*[^,()]+\s*,/i,
      rule: 'caller_application', message: 'RLS must not pass an application ID to the scope helper' }),
    rejectPattern(rlsSql, { pattern: /has_org_permission\(/i, rule: 'row_permission_helper',
      message: 'RLS must not call a row-scoped organization permission helper' }),
    rejectPattern(rlsSql, { pattern: /authorization_allowed_scope_ids\([^)]*"[a-z_][a-z0-9_]*"/i,
      rule: 'row_scope_argument', message: 'RLS must not pass a row column to the allowed-scope helper' }),
    rejectPattern(rlsSql, { pattern: /"[a-z_][a-z0-9_]*"::text\s*=\s*ANY|array_agg\(/i,
      rule: 'row_cast_scope_array', message: 'RLS must not cast the row column or use a per-row ANY scope array' }),
    rejectPattern(rlsSql, { pattern: TOP_LEVEL_DO_PATTERN,
      rule: 'rls_static_sql', message: 'RLS installation must not contain top-level procedural SQL' }),
    ...policyViolations(rlsSql),
  ];
}

function legacyCleanupViolations(cleanupSql: string): Array<ConformanceViolation | undefined> {
  return [
    requirePattern(cleanupSql, { pattern: /^\s*DROP\s+FUNCTION\s+IF\s+EXISTS\s+(?:"[a-z_][a-z0-9_]*"\.)?authorization_allowed_scope_ids\s*\(\s*TEXT\s*,\s*TEXT\s*,\s*TEXT\s*\)\s*;\s*$/i,
      rule: 'legacy_cleanup_target', message: 'Legacy cleanup must drop only the three-argument scope helper' }),
    rejectPattern(cleanupSql, { pattern: TOP_LEVEL_DO_PATTERN,
      rule: 'legacy_cleanup_static_sql', message: 'Legacy cleanup must not contain top-level procedural SQL' }),
    rejectPattern(cleanupSql, { pattern: /\bCASCADE\b/i,
      rule: 'legacy_cleanup_cascade', message: 'Legacy cleanup must fail closed when policies still depend on the helper' }),
  ];
}

export function checkAuthorizationSql(input: SqlConformanceInput): ConformanceReport {
  const installSql = executableSql(input.installSql);
  const projectionPreflightSql = executableSql(input.projectionPreflightSql);
  const rlsSql = executableSql(input.rlsSql);
  const cleanupViolations = input.legacyCleanupSql === undefined
    ? []
    : legacyCleanupViolations(executableSql(input.legacyCleanupSql));
  const violations = [
    ...projectionPreflightViolations(projectionPreflightSql),
    ...installationViolations(installSql),
    ...rlsViolations(rlsSql),
    ...cleanupViolations,
  ]
    .filter((violation): violation is ConformanceViolation => violation !== undefined);
  return report(violations);
}

function explainEntries(explainJson: unknown): ExplainEntry[] {
  if (!Array.isArray(explainJson) || !explainJson[0] || typeof explainJson[0] !== 'object') return [];
  const root = (explainJson[0] as ExplainNode).Plan;
  if (!root || typeof root !== 'object' || Array.isArray(root)) return [];
  const entries: ExplainEntry[] = [];
  const pending: ExplainEntry[] = [{ node: root as ExplainNode, ancestors: [] }];
  while (pending.length > 0) {
    const entry = pending.pop()!;
    entries.push(entry);
    const children = Array.isArray(entry.node.Plans) ? entry.node.Plans : [];
    for (const child of children) {
      if (child && typeof child === 'object' && !Array.isArray(child)) {
        pending.push({ node: child as ExplainNode, ancestors: [entry.node, ...entry.ancestors] });
      }
    }
  }
  return entries;
}

function hashedHelperSubplan(entry: ExplainEntry): boolean {
  const subplanNode = [entry.node, ...entry.ancestors].find(node =>
    node['Parent Relationship'] === 'SubPlan' && typeof node['Subplan Name'] === 'string');
  if (!subplanNode) return false;
  const hashedSubplan = `hashed ${subplanNode['Subplan Name']}`;
  return entry.ancestors.some(ancestor => String(ancestor.Filter || '').includes(hashedSubplan));
}

export function checkAuthorizationExplain(explainJson: unknown): ConformanceReport {
  const entries = explainEntries(explainJson);
  if (entries.length === 0) return report([{ rule: 'explain_json', message: 'EXPLAIN must use parsed FORMAT JSON output' }]);
  const helperEntries = entries.filter(entry =>
    entry.node['Function Name'] === 'authorization_allowed_scope_ids');
  const violations: ConformanceViolation[] = [];
  if (helperEntries.length === 0) {
    violations.push({ rule: 'helper_execution', message: 'EXPLAIN must contain the authorization helper plan node' });
  } else if (helperEntries.some(entry => entry.node['Actual Loops'] !== 1)) {
    violations.push({ rule: 'one_time_execution', message: 'Authorization helper plan nodes must execute once' });
  }
  if (helperEntries.length > 0 && helperEntries.some(entry => !hashedHelperSubplan(entry))) {
    violations.push({
      rule: 'one_time_scope_plan',
      message: 'Each authorization helper must belong to the hashed subplan referenced by its ancestor filter',
    });
  }
  return report(violations);
}
