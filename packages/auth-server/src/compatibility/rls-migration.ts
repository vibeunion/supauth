// RLS Migration Assistant (P1-7)
// Scans existing RLS policies and generates wrapper policies using supaoauth.authorize()
//
// Usage:
//   - With live Postgres: scans pg_policy and generates migration SQL
//   - With policy definitions provided: generates wrapper policies from input
//
// Migration pattern:
//   Existing:  USING (owner_id = auth.uid())
//   Wrapper:   USING (owner_id = auth.uid() OR supaoauth.authorize('resource.read'))

import postgres from 'postgres';

// ─── Types ────────────────────────────────────────────────────────────

export interface ExistingPolicy {
  schemaname: string;
  tablename: string;
  policyname: string;
  policytype: 'permissive' | 'restrictive';
  cmd: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL';
  qual: string | null; // USING expression
  with_check: string | null; // WITH CHECK expression
  roles: string[];
}

export interface WrapperPolicy {
  original_policy: string;
  wrapper_policy_name: string;
  tablename: string;
  schemaname: string;
  cmd: string;
  original_using: string | null;
  original_with_check: string | null;
  wrapper_using: string | null;
  wrapper_with_check: string | null;
  sql: string;
  permission_name: string;
}

export interface MigrationResult {
  scanned_policies: number;
  candidate_policies: number;
  wrappers: WrapperPolicy[];
  migration_sql: string;
  warnings: string[];
}

// ─── Live Postgres scanning ──────────────────────────────────────────

const SCAN_POLICIES_SQL = `
SELECT
  p.schemaname,
  p.tablename,
  p.policyname,
  CASE p.permissive WHEN 'PERMISSIVE' THEN 'permissive' ELSE 'restrictive' END AS policytype,
  p.cmd,
  pg_get_expr(p.qual, p.polrelid) AS qual,
  pg_get_expr(p.with_check, p.polrelid) AS with_check,
  COALESCE(pg_get_userbyid(a.principal_id), 'PUBLIC') AS roles
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN LATERAL unnest(p.polroles) WITH ORDINALITY AS a(principal_id, ordinality) ON true
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY p.schemaname, p.tablename, p.policyname;
`;

export async function scanExistingPolicies(databaseUrl: string): Promise<ExistingPolicy[]> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const rows = await sql.unsafe(SCAN_POLICIES_SQL);
    // Group by policy name (multiple roles become multiple rows)
    const policyMap = new Map<string, ExistingPolicy>();
    for (const row of rows as any[]) {
      const key = `${row.schemaname}.${row.tablename}.${row.policyname}`;
      if (policyMap.has(key)) {
        const existing = policyMap.get(key)!;
        if (!existing.roles.includes(row.roles)) {
          existing.roles.push(row.roles);
        }
      } else {
        policyMap.set(key, {
          schemaname: row.schemaname,
          tablename: row.tablename,
          policyname: row.policyname,
          policytype: row.policytype,
          cmd: row.cmd,
          qual: row.qual,
          with_check: row.with_check,
          roles: [row.roles],
        });
      }
    }
    return [...policyMap.values()];
  } finally {
    await sql.end();
  }
}

// ─── Pattern detection ────────────────────────────────────────────────

// Patterns that are safe to wrap with supaoauth.authorize()
const OWNER_PATTERNS = [
  /auth\.uid\(\)\s*=\s*(\w+)\.(\w+)/,                    // auth.uid() = table.column
  /(\w+)\.(\w+)\s*=\s*auth\.uid\(\)/,                    // table.column = auth.uid()
  /auth\.uid\(\)\s*=\s*(\w+)/,                             // auth.uid() = column (shorthand)
  /(\w+)\s*=\s*auth\.uid\(\)/,                             // column = auth.uid()
];

// Patterns that are unsafe (using JWT role for business RBAC)
const UNSAFE_ROLE_PATTERNS = [
  /auth\.jwt\(\)\s*->>\s*'role'\s*=\s*'(\w+)'/,          // auth.jwt() ->> 'role' = 'admin'
  /current_setting\(['"]request\.jwt\.claim\.role['"]\)\s*=\s*'(\w+)'/, // current_setting(...) = 'admin'
  /\(select\s+auth\.jwt\(\)\)\s*->>\s*'role'/,           // (select auth.jwt()) ->> 'role'
];

// Derive a permission name from table and operation
function derivePermissionName(tableName: string, cmd: string): string {
  const ops: Record<string, string> = {
    SELECT: 'read',
    INSERT: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    ALL: 'manage',
  };
  // Remove common suffixes
  const base = tableName.replace(/(s|es)?$/, '').replace(/_/g, '.');
  return `${base}.${ops[cmd] || 'access'}`;
}

// Generate wrapper SQL for a policy
function generateWrapperSQL(policy: ExistingPolicy, permissionName: string): { sql: string; wrapperUsing: string | null; wrapperWithCheck: string | null } {
  const wrapperName = `${policy.policyname}_with_rbac`;
  const role = policy.roles.includes('PUBLIC') ? 'PUBLIC' : policy.roles.join(', ');
  const cmdMap: Record<string, string> = { SELECT: 'FOR SELECT', INSERT: 'FOR INSERT', UPDATE: 'FOR UPDATE', DELETE: 'FOR DELETE', ALL: 'FOR ALL' };
  const cmdClause = cmdMap[policy.cmd] || 'FOR ALL';

  let wrapperUsing = policy.qual;
  let wrapperWithCheck = policy.with_check;

  if (policy.qual) {
    wrapperUsing = `(${policy.qual} OR supaoauth.authorize('${permissionName}'))`;
  } else {
    wrapperUsing = `supaoauth.authorize('${permissionName}')`;
  }

  if (policy.with_check) {
    wrapperWithCheck = `(${policy.with_check} OR supaoauth.authorize('${permissionName}'))`;
  } else if (policy.cmd === 'INSERT' || policy.cmd === 'UPDATE') {
    // INSERT/UPDATE policies often use WITH CHECK; if none existed, add RBAC check
    wrapperWithCheck = `supaoauth.authorize('${permissionName}')`;
  }

  const usingClause = wrapperUsing ? `\n  USING (${wrapperUsing})` : '';
  const withCheckClause = wrapperWithCheck ? `\n  WITH CHECK (${wrapperWithCheck})` : '';

  const sql = `CREATE POLICY "${wrapperName}"\nON ${policy.schemaname}.${policy.tablename}\n${cmdClause}\nTO ${role}${usingClause}${withCheckClause};`;

  return { sql, wrapperUsing, wrapperWithCheck };
}

// ─── Main migration assistant ─────────────────────────────────────────

export function generateWrapperPolicies(policies: ExistingPolicy[]): MigrationResult {
  const wrappers: WrapperPolicy[] = [];
  const warnings: string[] = [];

  for (const policy of policies) {
    // Skip restrictive policies — they limit access, don't grant it
    if (policy.policytype === 'restrictive') continue;

    // Check for unsafe patterns first
    const qualText = policy.qual || '';
    const checkText = policy.with_check || '';
    const fullText = `${qualText} ${checkText}`;

    for (const pattern of UNSAFE_ROLE_PATTERNS) {
      const match = fullText.match(pattern);
      if (match) {
        warnings.push(
          `UNSAFE: Policy "${policy.policyname}" on ${policy.schemaname}.${policy.tablename} uses JWT role claim '${match[1]}' for business authorization. ` +
          `This will break when SupaOAuth manages roles. Replace with supaoauth.authorize(...).`
        );
      }
    }

    // Check if policy is a candidate for wrapping (has auth.uid() owner pattern)
    const isOwnerPolicy = OWNER_PATTERNS.some(p => p.test(fullText));
    if (!isOwnerPolicy) continue;

    const permissionName = derivePermissionName(policy.tablename, policy.cmd);
    const { sql, wrapperUsing, wrapperWithCheck } = generateWrapperSQL(policy, permissionName);

    wrappers.push({
      original_policy: policy.policyname,
      wrapper_policy_name: `${policy.policyname}_with_rbac`,
      tablename: policy.tablename,
      schemaname: policy.schemaname,
      cmd: policy.cmd,
      original_using: policy.qual,
      original_with_check: policy.with_check,
      wrapper_using: wrapperUsing,
      wrapper_with_check: wrapperWithCheck,
      sql,
      permission_name: permissionName,
    });
  }

  // Build the full migration SQL
  const parts: string[] = [
    '-- SupaOAuth RLS Migration Assistant — Auto-generated wrapper policies',
    '-- Generated at: ' + new Date().toISOString(),
    '--',
    '-- These policies ADD RBAC authorization alongside existing owner-based policies.',
    '-- Existing policies are NOT dropped; the wrapper policies use OR to extend access.',
    '',
  ];

  if (wrappers.length > 0) {
    parts.push('-- Step 1: Verify supaoauth.authorize() helper exists');
    parts.push('-- (If not, install SupAuth through SupaCloud hosted migrations first: bun run install:supacloud)');
    parts.push('');
  }

  for (const w of wrappers) {
    parts.push(`-- Wrapper for: ${w.original_policy} on ${w.schemaname}.${w.tablename} (${w.cmd})`);
    parts.push(`-- Permission: ${w.permission_name}`);
    parts.push(w.sql);
    parts.push('');
  }

  if (warnings.length > 0) {
    parts.push('-- ─── WARNINGS ──────────────────────────────────────────');
    for (const warning of warnings) {
      parts.push(`-- WARNING: ${warning}`);
    }
  }

  return {
    scanned_policies: policies.length,
    candidate_policies: wrappers.length,
    wrappers,
    migration_sql: parts.join('\n'),
    warnings,
  };
}

// ─── CLI entry point ──────────────────────────────────────────────────

export async function runRLSMigrationAssistant(databaseUrl?: string) {
  const url = databaseUrl || process.env.DATABASE_URL || '';

  if (url) {
    console.log('Scanning existing RLS policies from Postgres...');
    const policies = await scanExistingPolicies(url);
    console.log(`Found ${policies.length} policies in public schema`);
    const result = generateWrapperPolicies(policies);
    console.log(`\nScanned: ${result.scanned_policies} policies`);
    console.log(`Candidates for RBAC wrapping: ${result.candidate_policies}`);
    if (result.warnings.length > 0) {
      console.log(`\nWarnings:`);
      for (const w of result.warnings) console.log(`  - ${w}`);
    }
    console.log(`\nGenerated migration SQL:\n`);
    console.log(result.migration_sql);
    return result;
  }

  // Demo mode — generate from sample policies
  console.log('No DATABASE_URL provided. Running in demo mode with sample policies...');
  const samplePolicies: ExistingPolicy[] = [
    {
      schemaname: 'public',
      tablename: 'projects',
      policyname: 'owner can read',
      policytype: 'permissive',
      cmd: 'SELECT',
      qual: 'owner_id = auth.uid()',
      with_check: null,
      roles: ['authenticated'],
    },
    {
      schemaname: 'public',
      tablename: 'projects',
      policyname: 'owner can update',
      policytype: 'permissive',
      cmd: 'UPDATE',
      qual: 'owner_id = auth.uid()',
      with_check: 'owner_id = auth.uid()',
      roles: ['authenticated'],
    },
    {
      schemaname: 'public',
      tablename: 'documents',
      policyname: 'team members can read',
      policytype: 'permissive',
      cmd: 'SELECT',
      qual: 'team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())',
      with_check: null,
      roles: ['authenticated'],
    },
    {
      schemaname: 'public',
      tablename: 'admin_only',
      policyname: 'admin access',
      policytype: 'permissive',
      cmd: 'ALL',
      qual: "auth.jwt() ->> 'role' = 'admin'",
      with_check: "auth.jwt() ->> 'role' = 'admin'",
      roles: ['authenticated'],
    },
  ];

  const result = generateWrapperPolicies(samplePolicies);
  console.log(`\nScanned: ${result.scanned_policies} policies`);
  console.log(`Candidates for RBAC wrapping: ${result.candidate_policies}`);
  if (result.warnings.length > 0) {
    console.log(`\nWarnings:`);
    for (const w of result.warnings) console.log(`  - ${w}`);
  }
  console.log(`\nGenerated migration SQL:\n`);
  console.log(result.migration_sql);
  return result;
}

// CLI usage: bun run src/compatibility/rls-migration.ts
if (import.meta.main) {
  runRLSMigrationAssistant().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
