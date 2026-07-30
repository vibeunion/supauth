// Supabase-native authorization compiler.
// Produces reviewable SQL/configuration artifacts for RLS, Storage, Realtime,
// and Edge Function gates without mutating tenant infrastructure.

export type AuthorizationOperation = 'read' | 'create' | 'update' | 'delete' | 'manage';

export interface AuthorizationTableTarget {
  schema?: string;
  table: string;
  permission_prefix?: string;
  operations?: AuthorizationOperation[];
  owner_column?: string;
  organization_column?: string;
}

export interface StorageBucketTarget {
  bucket_id: string;
  permission_prefix?: string;
  owner_path_prefix?: string;
  organization_path_prefix?: string;
  operations?: AuthorizationOperation[];
}

export interface RealtimeChannelTarget {
  topic: string;
  permission: string;
  organization_claim?: string;
}

export interface EdgeFunctionTarget {
  name: string;
  permission: string;
  require_organization?: boolean;
}

export interface AuthorizationCompileRequest {
  project_ref?: string;
  tables?: AuthorizationTableTarget[];
  storage_buckets?: StorageBucketTarget[];
  realtime_channels?: RealtimeChannelTarget[];
  edge_functions?: EdgeFunctionTarget[];
  include_helper_sql?: boolean;
}

export interface AuthorizationCompileResult {
  generated_at: string;
  assumptions: string[];
  warnings: string[];
  permissions: string[];
  sql: {
    helpers: string;
    tables: string;
    storage: string;
    realtime: string;
    rollback: string;
  };
  edge_functions: Array<{
    name: string;
    permission: string;
    middleware: string;
    negative_tests: string[];
  }>;
  negative_tests: string[];
  deploy_checklist: string[];
}

const DEFAULT_OPERATIONS: AuthorizationOperation[] = ['read', 'create', 'update', 'delete'];

const OPERATION_TO_SQL: Record<AuthorizationOperation, { command: string; suffix: string }> = {
  read: { command: 'SELECT', suffix: 'read' },
  create: { command: 'INSERT', suffix: 'create' },
  update: { command: 'UPDATE', suffix: 'update' },
  delete: { command: 'DELETE', suffix: 'delete' },
  manage: { command: 'ALL', suffix: 'manage' },
};

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function singularize(value: string): string {
  return value.replace(/(?:ies|es|s)$/i, match => match.toLowerCase() === 'ies' ? 'y' : '');
}

function normalizePermissionPrefix(target: { permission_prefix?: string }, fallback: string): string {
  return (target.permission_prefix || singularize(fallback).replace(/_/g, '.')).replace(/\.+/g, '.');
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function tablePolicyName(table: string, operation: AuthorizationOperation): string {
  return `supaoauth_${table}_${operation}`;
}

function storagePolicyName(bucketId: string, operation: AuthorizationOperation): string {
  return `supaoauth_storage_${bucketId}_${operation}`.replace(/[^\w]+/g, '_');
}

function buildTablePredicate(target: AuthorizationTableTarget, permission: string): string {
  if (target.organization_column) {
    return `supaoauth.has_org_permission(${quoteIdent(target.organization_column)}, ${quoteLiteral(permission)})`;
  }

  const rbac = `supaoauth.authorize(${quoteLiteral(permission)})`;
  if (target.owner_column) {
    return `(${quoteIdent(target.owner_column)} = auth.uid() OR ${rbac})`;
  }
  return rbac;
}

function buildTablePolicy(target: AuthorizationTableTarget, operation: AuthorizationOperation, permission: string): string {
  const schema = target.schema || 'public';
  const tableRef = `${quoteIdent(schema)}.${quoteIdent(target.table)}`;
  const command = OPERATION_TO_SQL[operation].command;
  const predicate = buildTablePredicate(target, permission);
  const usingClause = command === 'INSERT' ? '' : `\n  USING (${predicate})`;
  const withCheckClause = command === 'SELECT' || command === 'DELETE' ? '' : `\n  WITH CHECK (${predicate})`;

  return [
    `CREATE POLICY ${quoteIdent(tablePolicyName(target.table, operation))}`,
    `ON ${tableRef}`,
    `FOR ${command}`,
    'TO authenticated' + usingClause + withCheckClause + ';',
  ].join('\n');
}

function buildStoragePredicate(target: StorageBucketTarget, permission: string): string {
  const rbac = `supaoauth.authorize(${quoteLiteral(permission)})`;
  const clauses = [`bucket_id = ${quoteLiteral(target.bucket_id)}`];
  if (target.owner_path_prefix) {
    clauses.push(`(storage.foldername(name))[1] = auth.uid()::text`);
  }
  if (target.organization_path_prefix) {
    clauses.push(`(storage.foldername(name))[1] = (supaoauth.current_project_claims() ->> 'current_org_id')`);
  }
  clauses.push(rbac);
  return clauses.length > 2
    ? `bucket_id = ${quoteLiteral(target.bucket_id)} AND (${clauses.slice(1).join(' OR ')})`
    : clauses.join(' AND ');
}

function buildStoragePolicy(target: StorageBucketTarget, operation: AuthorizationOperation, permission: string): string {
  const command = OPERATION_TO_SQL[operation].command;
  const predicate = buildStoragePredicate(target, permission);
  const usingClause = command === 'INSERT' ? '' : `\n  USING (${predicate})`;
  const withCheckClause = command === 'SELECT' || command === 'DELETE' ? '' : `\n  WITH CHECK (${predicate})`;

  return [
    `CREATE POLICY ${quoteIdent(storagePolicyName(target.bucket_id, operation))}`,
    'ON storage.objects',
    `FOR ${command}`,
    'TO authenticated' + usingClause + withCheckClause + ';',
  ].join('\n');
}

function buildRealtimePolicy(target: RealtimeChannelTarget): string {
  const orgPredicate = target.organization_claim
    ? ` AND (supaoauth.current_project_claims() ->> ${quoteLiteral(target.organization_claim)}) IS NOT NULL`
    : '';
  return [
    `-- Realtime Authorization template for topic: ${target.topic}`,
    '-- Apply this to your realtime authorization table/function if your Supabase runtime exposes one.',
    `-- Required permission: ${target.permission}`,
    `-- Predicate: realtime.topic() = ${quoteLiteral(target.topic)} AND supaoauth.authorize(${quoteLiteral(target.permission)})${orgPredicate}`,
  ].join('\n');
}

function buildEdgeFunctionMiddleware(target: EdgeFunctionTarget, projectRef?: string): string {
  const orgLine = target.require_organization
    ? projectRef
      ? `const projectClaims = claims.app_metadata?.supaoauth?.schema_version === 2\n  ? claims.app_metadata.supaoauth.projects?.[${JSON.stringify(projectRef)}]\n  : undefined;\nconst organizationId = projectClaims?.current_org_id;\nif (!organizationId) return new Response('Missing organization context', { status: 403 });\n`
      : "const projectClaims = undefined;\nif (!projectClaims) return new Response('Missing project authorization context', { status: 403 });\n"
    : '';
  return [
    `// ${target.name}: SupaOAuth Edge Function authorization gate`,
    "const token = req.headers.get('authorization')?.replace(/^Bearer\\s+/i, '');",
    "if (!token) return new Response('Missing bearer token', { status: 401 });",
    '// Verify the JWT with Supabase runtime/JWKS before trusting claims.',
    'const claims = await verifySupabaseJwt(token);',
    orgLine + `const allowed = await supaoauthAuthorize(claims.sub, ${quoteLiteral(target.permission)});`,
    "if (!allowed) return new Response('Forbidden', { status: 403 });",
  ].filter(Boolean).join('\n');
}

const HELPER_SQL = `-- SupaOAuth helper functions are installed by the main auth-server migration.
-- Verify these functions exist before applying generated policies:
--   supaoauth.authorize(permission_name text, target_organization_id uuid default null)
--   supaoauth.has_permission(permission_name text, target_organization_id uuid default null)
--   supaoauth.has_org_permission(organization_id uuid, permission_name text)
-- Install SupAuth through SupaCloud hosted migrations first: bun run install:supacloud`;

export function compileAuthorizationPlan(request: AuthorizationCompileRequest = {}): AuthorizationCompileResult {
  const warnings: string[] = [];
  const assumptions = [
    'GoTrue/Supabase remains the JWT issuer and top-level JWT role keeps Supabase semantics.',
    'RLS authorization is delegated to supaoauth.authorize(...) or supaoauth.has_org_permission(...).',
    'Generated SQL is review-only and is not applied by this compiler.',
  ];

  const tableStatements: string[] = [];
  const storageStatements: string[] = [];
  const realtimeStatements: string[] = [];
  const rollbackStatements: string[] = [];
  const permissionNames: string[] = [];
  if (!request.project_ref && request.edge_functions?.some((target) => target.require_organization)) {
    warnings.push('project_ref is required for project-scoped Edge Function organization claims; generated middleware fails closed.');
  }

  for (const table of request.tables || []) {
    if (!table.table) {
      warnings.push('Skipped a table target without table name.');
      continue;
    }
    if (!table.owner_column && !table.organization_column) {
      warnings.push(`Table ${table.schema || 'public'}.${table.table} has no owner_column or organization_column; policy will be RBAC-only.`);
    }

    const operations = table.operations?.length ? table.operations : DEFAULT_OPERATIONS;
    const prefix = normalizePermissionPrefix(table, table.table);
    for (const operation of operations) {
      const permission = `${prefix}.${OPERATION_TO_SQL[operation].suffix}`;
      permissionNames.push(permission);
      tableStatements.push(buildTablePolicy(table, operation, permission));
      rollbackStatements.push(`DROP POLICY IF EXISTS ${quoteIdent(tablePolicyName(table.table, operation))} ON ${quoteIdent(table.schema || 'public')}.${quoteIdent(table.table)};`);
    }
  }

  for (const bucket of request.storage_buckets || []) {
    if (!bucket.bucket_id) {
      warnings.push('Skipped a storage bucket target without bucket_id.');
      continue;
    }
    const operations = bucket.operations?.length ? bucket.operations : DEFAULT_OPERATIONS;
    const prefix = normalizePermissionPrefix(bucket, bucket.bucket_id);
    for (const operation of operations) {
      const permission = `${prefix}.${OPERATION_TO_SQL[operation].suffix}`;
      permissionNames.push(permission);
      storageStatements.push(buildStoragePolicy(bucket, operation, permission));
      rollbackStatements.push(`DROP POLICY IF EXISTS ${quoteIdent(storagePolicyName(bucket.bucket_id, operation))} ON storage.objects;`);
    }
  }

  for (const channel of request.realtime_channels || []) {
    if (!channel.topic || !channel.permission) {
      warnings.push('Skipped a realtime target without topic or permission.');
      continue;
    }
    permissionNames.push(channel.permission);
    realtimeStatements.push(buildRealtimePolicy(channel));
  }

  const edgeFunctions = (request.edge_functions || []).filter(fn => {
    if (!fn.name || !fn.permission) {
      warnings.push('Skipped an edge function target without name or permission.');
      return false;
    }
    permissionNames.push(fn.permission);
    return true;
  }).map(fn => ({
    name: fn.name,
    permission: fn.permission,
    middleware: buildEdgeFunctionMiddleware(fn, request.project_ref),
    negative_tests: [
      `${fn.name}: request without bearer token returns 401`,
      `${fn.name}: valid token without ${fn.permission} returns 403`,
      `${fn.name}: revoked role assignment returns 403 before token refresh`,
    ],
  }));

  const uniquePermissions = unique(permissionNames).sort();
  const negativeTests = [
    ...uniquePermissions.map(permission => `User without ${permission} is denied`),
    ...uniquePermissions.map(permission => `Revoking ${permission} takes effect without waiting for JWT refresh`),
    'JWT role remains a Supabase runtime role (anon/authenticated/service_role) and business roles are not written to the top-level role claim',
  ];

  return {
    generated_at: new Date().toISOString(),
    assumptions,
    warnings,
    permissions: uniquePermissions,
    sql: {
      helpers: request.include_helper_sql === false ? '' : HELPER_SQL,
      tables: tableStatements.join('\n\n'),
      storage: storageStatements.join('\n\n'),
      realtime: realtimeStatements.join('\n\n'),
      rollback: rollbackStatements.join('\n'),
    },
    edge_functions: edgeFunctions,
    negative_tests: negativeTests,
    deploy_checklist: [
      'Run auth-server migration and verify supaoauth.authorize / supaoauth.has_org_permission grants.',
      'Create or sync matching SupaOAuth permissions before applying policies.',
      'Apply generated RLS/Storage SQL in a staging project first.',
      'Run generated negative tests with users that have no roles, stale JWTs, and revoked assignments.',
      'Run /v1/compatibility/supabase and release gate before production rollout.',
    ],
  };
}
