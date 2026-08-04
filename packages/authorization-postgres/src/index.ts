const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const PERMISSION_PATTERN = /^[a-z][a-z0-9._-]*:[a-z][a-z0-9._-]*$/;
const CONTEXT_VALUE_PATTERN = /^[^\s]{1,512}$/u;

export interface AuthorizationSchemaOptions {
  schema: string;
}

export type RlsCommand = 'select' | 'insert' | 'update' | 'delete';

export interface RlsPermissionPolicy {
  command: RlsCommand;
  permission: string;
}

export interface RlsPolicyOptions extends AuthorizationSchemaOptions {
  tableSchema: string;
  table: string;
  domainColumn: string;
  domainIdType: 'uuid' | 'text';
  domainType: string;
  applicationId: string;
  policies: readonly RlsPermissionPolicy[];
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
  if (!PERMISSION_PATTERN.test(permissionName)) {
    throw new TypeError(`Invalid permission ${JSON.stringify(permissionName)}; expected resource:action`);
  }
  return `'${permissionName}'`;
}

function adapterContractSql(schemaName: string): string {
  return `DO $$
BEGIN
  IF to_regclass('${schemaName}.active_memberships') IS NULL THEN
    RAISE EXCEPTION '${schemaName}.active_memberships adapter view is required';
  END IF;
  IF to_regclass('${schemaName}.active_role_assignments') IS NULL THEN
    RAISE EXCEPTION '${schemaName}.active_role_assignments adapter view is required';
  END IF;
END $$;`;
}

function allowedScopeFunctionSql(schemaRef: string): string {
  return `CREATE OR REPLACE FUNCTION ${schemaRef}.authorization_allowed_scope_ids(
  requested_permission TEXT,
  requested_domain_type TEXT,
  requested_application_id TEXT
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
      COALESCE(
        claims -> 'app_metadata' -> 'authorization_context' ->> 'subject',
        claims ->> 'sub'
      ) AS principal_subject,
      COALESCE(
        claims ->> 'client_id',
        claims -> 'app_metadata' -> 'authorization_context' ->> 'application_id'
      ) AS application_id
    FROM jwt_context
  ), membership_candidates AS (
    SELECT
      membership.membership_key,
      membership.domain_id,
      COUNT(*) OVER (PARTITION BY membership.domain_id) AS membership_count
    FROM ${schemaRef}.active_memberships AS membership
    CROSS JOIN current_principal
    WHERE membership.principal_kind = current_principal.principal_kind
      AND current_principal.principal_kind IN ('user', 'service')
      AND membership.principal_issuer = current_principal.principal_issuer
      AND membership.principal_subject = current_principal.principal_subject
      AND membership.application_id = current_principal.application_id
      AND membership.application_id = requested_application_id
      AND membership.domain_type = requested_domain_type
  ), eligible_memberships AS (
    SELECT membership_key, domain_id
    FROM membership_candidates
    WHERE membership_count = 1
  ), allowed_scope_ids AS (
    SELECT DISTINCT membership.domain_id AS scope_id
    FROM eligible_memberships AS membership
    JOIN ${schemaRef}.active_role_assignments AS assignment
      ON assignment.membership_key = membership.membership_key
    JOIN ${schemaRef}.role_permissions AS role_permission
      ON role_permission.role_key = assignment.role_key
    WHERE role_permission.permission_name = requested_permission
  )
  SELECT allowed_scope_ids.scope_id FROM allowed_scope_ids;
$$;`;
}

export function generateAuthorizationSchemaSql(options: AuthorizationSchemaOptions): string {
  const schemaRef = identifier('schema', options.schema);
  const statements = [
    `CREATE SCHEMA IF NOT EXISTS ${schemaRef};`,
    `CREATE TABLE IF NOT EXISTS ${schemaRef}.permission_catalog (
  permission_name TEXT PRIMARY KEY CHECK (permission_name ~ '^[a-z][a-z0-9._-]*:[a-z][a-z0-9._-]*$'),
  description TEXT
);`,
    `CREATE TABLE IF NOT EXISTS ${schemaRef}.role_permissions (
  role_key TEXT NOT NULL,
  permission_name TEXT NOT NULL REFERENCES ${schemaRef}.permission_catalog(permission_name) ON DELETE CASCADE,
  PRIMARY KEY (role_key, permission_name)
);`,
    adapterContractSql(options.schema),
    allowedScopeFunctionSql(schemaRef),
    `REVOKE ALL ON SCHEMA ${schemaRef} FROM PUBLIC;`,
    `GRANT USAGE ON SCHEMA ${schemaRef} TO authenticated;`,
    `REVOKE ALL ON FUNCTION ${schemaRef}.authorization_allowed_scope_ids(TEXT, TEXT, TEXT) FROM PUBLIC;`,
    `REVOKE ALL ON FUNCTION ${schemaRef}.authorization_allowed_scope_ids(TEXT, TEXT, TEXT) FROM anon;`,
    `GRANT EXECUTE ON FUNCTION ${schemaRef}.authorization_allowed_scope_ids(TEXT, TEXT, TEXT) TO authenticated;`,
  ];
  return statements.join('\n\n');
}

function allowedScopePredicate(options: RlsPolicyOptions, policy: RlsPermissionPolicy): string {
  const schemaRef = identifier('schema', options.schema);
  const domainColumn = identifier('domainColumn', options.domainColumn);
  const permissionName = permissionLiteral(policy.permission);
  const domainType = literal('domainType', options.domainType);
  const applicationId = literal('applicationId', options.applicationId);
  const scopeId = options.domainIdType === 'uuid' ? 'allowed_scope.scope_id::uuid' : 'allowed_scope.scope_id';
  return `${domainColumn} IN (
    SELECT ${scopeId}
    FROM ${schemaRef}.authorization_allowed_scope_ids(${permissionName}, ${domainType}, ${applicationId}) AS allowed_scope
  )`;
}

function policySql(options: RlsPolicyOptions, policy: RlsPermissionPolicy): string {
  const tableRef = `${identifier('tableSchema', options.tableSchema)}.${identifier('table', options.table)}`;
  const policyName = identifier('policy name', `authorization_${policy.command}`);
  const predicate = allowedScopePredicate(options, policy);
  const command = policy.command.toUpperCase();
  const usingClause = command === 'INSERT' ? '' : `\n  USING (${predicate})`;
  const checkClause = command === 'SELECT' || command === 'DELETE' ? '' : `\n  WITH CHECK (${predicate})`;
  return `CREATE POLICY ${policyName}\nON ${tableRef}\nFOR ${command}\nTO authenticated${usingClause}${checkClause};`;
}

export function generateRlsPoliciesSql(options: RlsPolicyOptions): string {
  if (options.policies.length === 0) throw new TypeError('At least one RLS policy is required');
  const commands = options.policies.map(policy => policy.command);
  if (new Set(commands).size !== commands.length) throw new TypeError('RLS policy commands must be unique');
  const tableRef = `${identifier('tableSchema', options.tableSchema)}.${identifier('table', options.table)}`;
  return [
    `ALTER TABLE ${tableRef} ENABLE ROW LEVEL SECURITY;`,
    ...options.policies.map(policy => policySql(options, policy)),
  ].join('\n\n');
}
