const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const PERMISSION_PATTERN = /^[a-z][a-z0-9._-]*:[a-z][a-z0-9._-]*$/;
const CONTEXT_VALUE_PATTERN = /^[^\s]{1,512}$/u;

export interface AuthorizationSchemaOptions {
  readonly schema: string;
  readonly applicationId: string;
}

export type RlsCommand = 'select' | 'insert' | 'update' | 'delete';

export type RlsPermissionPolicy =
  | { readonly command: 'select' | 'delete'; readonly usingPermission: string }
  | { readonly command: 'insert'; readonly checkPermission: string }
  | { readonly command: 'update'; readonly usingPermission: string; readonly checkPermission: string };

export interface RlsPolicyOptions {
  readonly schema: string;
  readonly tableSchema: string;
  readonly table: string;
  readonly domainColumn: string;
  readonly domainIdType: 'uuid' | 'text';
  readonly domainType: string;
  readonly policies: readonly RlsPermissionPolicy[];
}

function identifier(label: string, identifierValue: string): string {
  if (!IDENTIFIER_PATTERN.test(identifierValue) || identifierValue.startsWith('pg_')) {
    throw new TypeError(`${label} must be a safe unquoted PostgreSQL identifier`);
  }
  return `"${identifierValue}"`;
}

function literal(label: string, literalValue: string): string {
  if (!CONTEXT_VALUE_PATTERN.test(literalValue)) {
    throw new TypeError(`${label} must be a non-empty value without whitespace`);
  }
  return `'${literalValue.replace(/'/g, "''")}'`;
}

function permissionLiteral(permissionName: string): string {
  if (permissionName.length > 512 || !PERMISSION_PATTERN.test(permissionName)) {
    throw new TypeError(`Invalid permission ${JSON.stringify(permissionName)}; expected resource:action`);
  }
  return `'${permissionName}'`;
}

function projectionExistenceViolationQueries(projectionLabel: string): string {
  return `SELECT 'projection_missing'::TEXT AS rule,
  '${projectionLabel} projection view is required'::TEXT AS message
FROM projection
WHERE relation_oid IS NULL
UNION ALL
SELECT 'projection_kind', '${projectionLabel} must be an ordinary view'
FROM projection
WHERE relation_oid IS NOT NULL
  AND (SELECT relation.relkind FROM pg_catalog.pg_class AS relation WHERE relation.oid = relation_oid)
    IS DISTINCT FROM 'v'`;
}

function projectionColumnViolationQuery(projectionLabel: string): string {
  return `SELECT 'projection_columns', '${projectionLabel} columns do not match the required contract'
FROM projection
WHERE relation_oid IS NOT NULL
  AND ARRAY(
    SELECT attribute.attname::TEXT
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = relation_oid
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
    ORDER BY attribute.attnum
  ) IS DISTINCT FROM ARRAY[
    'principal_kind', 'principal_issuer', 'principal_subject', 'application_id',
    'domain_type', 'domain_id', 'permission_name'
  ]::TEXT[]`;
}

function projectionColumnTypeViolationQuery(projectionLabel: string): string {
  return `SELECT 'projection_column_types', '${projectionLabel} columns must all use TEXT'
FROM projection
WHERE relation_oid IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = relation_oid
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.atttypid <> 'pg_catalog.text'::pg_catalog.regtype
  )`;
}

function projectionPrivilegeViolationQuery(projectionLabel: string): string {
  return `SELECT 'projection_privileges', '${projectionLabel} must not be directly readable by API roles'
FROM projection
WHERE relation_oid IS NOT NULL
  AND (
    pg_catalog.has_table_privilege('anon', relation_oid, 'SELECT')
    OR pg_catalog.has_table_privilege('authenticated', relation_oid, 'SELECT')
  )`;
}

function projectionViolationQueries(projectionLabel: string): string {
  return [
    projectionExistenceViolationQueries(projectionLabel),
    projectionColumnViolationQuery(projectionLabel),
    projectionColumnTypeViolationQuery(projectionLabel),
    projectionPrivilegeViolationQuery(projectionLabel),
  ].join('\nUNION ALL\n');
}

export function generateAuthorizationProjectionPreflightSql(
  options: Pick<AuthorizationSchemaOptions, 'schema'>,
): string {
  const schemaRef = identifier('schema', options.schema);
  const projectionName = literal('projection', `${schemaRef}."effective_permission_grants"`);
  const projectionLabel = `${options.schema}.effective_permission_grants`;
  return `WITH projection AS (
  SELECT pg_catalog.to_regclass(${projectionName}) AS relation_oid
), violations(rule, message) AS (
${projectionViolationQueries(projectionLabel)}
)
SELECT rule, message
FROM violations
ORDER BY rule;`;
}

function allowedScopeFunctionSql(schemaRef: string, applicationId: string): string {
  const installedApplicationId = literal('applicationId', applicationId);
  return `CREATE OR REPLACE FUNCTION ${schemaRef}.authorization_allowed_scope_ids(
  requested_permission TEXT,
  requested_domain_type TEXT
)
RETURNS TABLE(scope_id TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH jwt_context AS (
    SELECT (SELECT "auth"."jwt"()) AS claims
  ), current_principal AS (
    SELECT
      COALESCE(claims -> 'app_metadata' -> 'authorization_context' ->> 'kind', 'user') AS principal_kind,
      claims ->> 'iss' AS principal_issuer,
      CASE
        WHEN claims -> 'app_metadata' -> 'authorization_context' ->> 'kind' = 'service'
          THEN claims -> 'app_metadata' -> 'authorization_context' ->> 'subject'
        ELSE claims ->> 'sub'
      END AS principal_subject,
      CASE
        WHEN claims ? 'client_id' THEN claims ->> 'client_id'
        WHEN (claims -> 'app_metadata' -> 'authorization_context') ? 'application_id'
          THEN claims -> 'app_metadata' -> 'authorization_context' ->> 'application_id'
        ELSE NULL
      END AS token_application_id,
      claims ? 'client_id'
        OR COALESCE(
          (claims -> 'app_metadata' -> 'authorization_context') ? 'application_id',
          FALSE
        )
        AS has_token_application_claim
    FROM jwt_context
  ), allowed_scope_ids AS (
    SELECT DISTINCT permission_grant.domain_id AS scope_id
    FROM ${schemaRef}.effective_permission_grants AS permission_grant
    CROSS JOIN current_principal
    WHERE permission_grant.principal_kind = current_principal.principal_kind
      AND current_principal.principal_kind IN ('user', 'service')
      AND current_principal.principal_issuer ~ '^[^[:space:]]+$'
      AND current_principal.principal_subject ~ '^[^[:space:]]+$'
      AND requested_permission ~ '^[a-z][a-z0-9._-]*:[a-z][a-z0-9._-]*$'
      AND requested_domain_type ~ '^[^[:space:]]+$'
      AND permission_grant.domain_id ~ '^[^[:space:]]+$'
      AND permission_grant.principal_issuer = current_principal.principal_issuer
      AND permission_grant.principal_subject = current_principal.principal_subject
      AND permission_grant.application_id = ${installedApplicationId}
      AND (
        NOT current_principal.has_token_application_claim
        OR current_principal.token_application_id = ${installedApplicationId}
      )
      AND permission_grant.domain_type = requested_domain_type
      AND permission_grant.permission_name = requested_permission
  )
  SELECT allowed_scope_ids.scope_id FROM allowed_scope_ids;
$$;`;
}

export function generateAuthorizationSchemaSql(options: AuthorizationSchemaOptions): string {
  const schemaRef = identifier('schema', options.schema);
  const statements = [
    `CREATE SCHEMA IF NOT EXISTS ${schemaRef};`,
    allowedScopeFunctionSql(schemaRef, options.applicationId),
    `REVOKE ALL ON SCHEMA ${schemaRef} FROM PUBLIC;`,
    `GRANT USAGE ON SCHEMA ${schemaRef} TO authenticated;`,
    `REVOKE ALL ON FUNCTION ${schemaRef}.authorization_allowed_scope_ids(TEXT, TEXT) FROM PUBLIC;`,
    `REVOKE ALL ON FUNCTION ${schemaRef}.authorization_allowed_scope_ids(TEXT, TEXT) FROM anon;`,
    `GRANT EXECUTE ON FUNCTION ${schemaRef}.authorization_allowed_scope_ids(TEXT, TEXT) TO authenticated;`,
  ];
  return statements.join('\n\n');
}

export function generateLegacyAuthorizationCleanupSql(options: Pick<AuthorizationSchemaOptions, 'schema'>): string {
  const schemaRef = identifier('schema', options.schema);
  return `DROP FUNCTION IF EXISTS ${schemaRef}.authorization_allowed_scope_ids(TEXT, TEXT, TEXT);`;
}

function allowedScopePredicate(options: RlsPolicyOptions, permissionName: string): string {
  const schemaRef = identifier('schema', options.schema);
  const domainColumn = identifier('domainColumn', options.domainColumn);
  const requestedPermission = permissionLiteral(permissionName);
  const domainType = literal('domainType', options.domainType);
  const scopeId = options.domainIdType === 'uuid' ? 'allowed_scope.scope_id::uuid' : 'allowed_scope.scope_id';
  return `${domainColumn} IN (
    SELECT ${scopeId}
    FROM ${schemaRef}.authorization_allowed_scope_ids(${requestedPermission}, ${domainType}) AS allowed_scope
  )`;
}

function policyClauses(options: RlsPolicyOptions, policy: RlsPermissionPolicy): string {
  switch (policy.command) {
    case 'select':
    case 'delete':
      return `\n  USING (${allowedScopePredicate(options, policy.usingPermission)})`;
    case 'insert':
      return `\n  WITH CHECK (${allowedScopePredicate(options, policy.checkPermission)})`;
    case 'update':
      return `\n  USING (${allowedScopePredicate(options, policy.usingPermission)})`
        + `\n  WITH CHECK (${allowedScopePredicate(options, policy.checkPermission)})`;
  }
}

function policySql(options: RlsPolicyOptions, policy: RlsPermissionPolicy): string {
  const tableRef = `${identifier('tableSchema', options.tableSchema)}.${identifier('table', options.table)}`;
  const policyName = identifier('policy name', `authorization_${policy.command}`);
  const command = policy.command.toUpperCase();
  return `DROP POLICY IF EXISTS ${policyName} ON ${tableRef};\n\nCREATE POLICY ${policyName}\nON ${tableRef}\nFOR ${command}\nTO authenticated${policyClauses(options, policy)};`;
}

function assertRlsOptions(options: RlsPolicyOptions): void {
  if (options.domainIdType !== 'uuid' && options.domainIdType !== 'text') {
    throw new TypeError('domainIdType must be uuid or text');
  }
  if (options.policies.length === 0) throw new TypeError('At least one RLS policy is required');
  const commands = options.policies.map(policy => policy.command);
  if (commands.some(command => !['select', 'insert', 'update', 'delete'].includes(command))) {
    throw new TypeError('RLS policy command is invalid');
  }
  if (new Set(commands).size !== commands.length) throw new TypeError('RLS policy commands must be unique');
}

export function generateRlsPoliciesSql(options: RlsPolicyOptions): string {
  assertRlsOptions(options);
  const tableRef = `${identifier('tableSchema', options.tableSchema)}.${identifier('table', options.table)}`;
  return [
    `ALTER TABLE ${tableRef} ENABLE ROW LEVEL SECURITY;`,
    ...options.policies.map(policy => policySql(options, policy)),
  ].join('\n\n');
}
