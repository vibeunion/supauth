// RBAC migration verification (P1-8).
// Short-lived read-only probe used after SupaCloud hosted migrations are applied.

import postgres from 'postgres';

export interface UnsafePolicyRow {
  schemaname: string;
  tablename: string;
  policyname: string;
  qual: string | null;
  with_check: string | null;
}

export interface RbacDbVerification {
  reachable: boolean;
  authorizeExists?: boolean;
  hasPermissionExists?: boolean;
  hasOrgPermissionExists?: boolean;
  currentProjectClaimsExists?: boolean;
  currentPermissionClaimsExists?: boolean;
  authorizeGranted?: boolean;
  hasPermissionGranted?: boolean;
  hasOrgPermissionGranted?: boolean;
  currentProjectClaimsGranted?: boolean;
  currentPermissionClaimsGranted?: boolean;
  currentPermissionClaimsPublicRevoked?: boolean;
  currentPermissionClaimsAnonRevoked?: boolean;
  currentPermissionClaimsSecurityDefiner?: boolean;
  currentPermissionClaimsSearchPathHardened?: boolean;
  legacyWebhooksAbsent?: boolean;
  legacyWebhookDeliveriesAbsent?: boolean;
  unsafePolicies?: UnsafePolicyRow[];
  error?: string;
}

// 单次连接尝试与整体探测都有上限，避免离线/坏 URL 长时间挂起。
const CONNECT_TIMEOUT_SEC = 3;
const PROBE_BUDGET_MS = 6000;

async function probe(sql: ReturnType<typeof postgres>): Promise<RbacDbVerification> {
  const result: RbacDbVerification = { reachable: false };

  // 连通性探针：连不上直接回退，不再执行后续目录查询。
  await sql`select 1`;
  result.reachable = true;

  // RB-1 / RB-2 / RB-3：用 to_regprocedure 做签名级探测。
  // 直接把缺失函数签名传给 has_function_privilege 会抛错，导致 helper 缺失被误报成数据库不可达。
  const helperState = await sql`
    WITH helpers AS (
      SELECT
        to_regprocedure('supaoauth.authorize(text, uuid)') AS authorize_oid,
        to_regprocedure('supaoauth.has_permission(text, uuid)') AS has_permission_oid,
        to_regprocedure('supaoauth.has_org_permission(uuid, text)') AS has_org_permission_oid,
        to_regprocedure('supaoauth.current_project_claims()') AS current_project_claims_oid,
        to_regprocedure('supaoauth.current_permission_claims(uuid)') AS current_permission_claims_oid
    ), current_permission_contract AS (
      SELECT
        EXISTS (
          SELECT 1
          FROM aclexplode(COALESCE(pg_proc.proacl, acldefault('f', pg_proc.proowner))) AS function_acl
          JOIN pg_roles ON pg_roles.oid = function_acl.grantee
          WHERE pg_roles.rolname = 'authenticated' AND function_acl.privilege_type = 'EXECUTE'
        ) AS authenticated_granted,
        NOT EXISTS (
          SELECT 1
          FROM aclexplode(COALESCE(pg_proc.proacl, acldefault('f', pg_proc.proowner))) AS function_acl
          WHERE function_acl.grantee = 0 AND function_acl.privilege_type = 'EXECUTE'
        ) AS public_revoked,
        NOT has_function_privilege('anon', pg_proc.oid, 'EXECUTE') AS anon_revoked,
        pg_proc.prosecdef AS security_definer,
        EXISTS (
          SELECT 1 FROM unnest(pg_proc.proconfig) AS function_setting
          WHERE function_setting ~ '^search_path=(""|)$'
        ) AS search_path_hardened
      FROM helpers
      JOIN pg_proc ON pg_proc.oid = current_permission_claims_oid
    )
    SELECT
      authorize_oid IS NOT NULL AS authorize_exists,
      has_permission_oid IS NOT NULL AS has_permission_exists,
      has_org_permission_oid IS NOT NULL AS has_org_permission_exists,
      current_project_claims_oid IS NOT NULL AS current_project_claims_exists,
      current_permission_claims_oid IS NOT NULL AS current_permission_claims_exists,
      to_regclass('supaoauth.webhooks') IS NULL AS legacy_webhooks_absent,
      to_regclass('supaoauth.webhook_deliveries') IS NULL AS legacy_webhook_deliveries_absent,
      CASE
        WHEN authorize_oid IS NULL THEN NULL
        ELSE has_function_privilege('authenticated', authorize_oid, 'EXECUTE')
      END AS authorize_granted,
      CASE
        WHEN has_permission_oid IS NULL THEN NULL
        ELSE has_function_privilege('authenticated', has_permission_oid, 'EXECUTE')
      END AS has_permission_granted,
      CASE
        WHEN has_org_permission_oid IS NULL THEN NULL
        ELSE has_function_privilege('authenticated', has_org_permission_oid, 'EXECUTE')
      END AS has_org_permission_granted,
      CASE
        WHEN current_project_claims_oid IS NULL THEN NULL
        ELSE has_function_privilege('authenticated', current_project_claims_oid, 'EXECUTE')
      END AS current_project_claims_granted,
      CASE
        WHEN current_permission_claims_oid IS NULL THEN NULL
        ELSE current_permission_contract.authenticated_granted
      END AS current_permission_claims_granted,
      current_permission_contract.public_revoked AS current_permission_claims_public_revoked,
      current_permission_contract.anon_revoked AS current_permission_claims_anon_revoked,
      current_permission_contract.security_definer AS current_permission_claims_security_definer,
      current_permission_contract.search_path_hardened AS current_permission_claims_search_path_hardened
    FROM helpers
    LEFT JOIN current_permission_contract ON true`;
  const helperRow = ((helperState as unknown as Array<{
    authorize_exists: boolean | null;
    has_permission_exists: boolean | null;
    has_org_permission_exists: boolean | null;
    current_project_claims_exists: boolean | null;
    current_permission_claims_exists: boolean | null;
    legacy_webhooks_absent: boolean | null;
    legacy_webhook_deliveries_absent: boolean | null;
    authorize_granted: boolean | null;
    has_permission_granted: boolean | null;
    has_org_permission_granted: boolean | null;
    current_project_claims_granted: boolean | null;
    current_permission_claims_granted: boolean | null;
    current_permission_claims_public_revoked: boolean | null;
    current_permission_claims_anon_revoked: boolean | null;
    current_permission_claims_security_definer: boolean | null;
    current_permission_claims_search_path_hardened: boolean | null;
  }>)[0] ?? {
    authorize_exists: null,
    has_permission_exists: null,
    has_org_permission_exists: null,
    current_project_claims_exists: null,
    current_permission_claims_exists: null,
    legacy_webhooks_absent: null,
    legacy_webhook_deliveries_absent: null,
    authorize_granted: null,
    has_permission_granted: null,
    has_org_permission_granted: null,
    current_project_claims_granted: null,
    current_permission_claims_granted: null,
    current_permission_claims_public_revoked: null,
    current_permission_claims_anon_revoked: null,
    current_permission_claims_security_definer: null,
    current_permission_claims_search_path_hardened: null,
  });
  result.authorizeExists = helperRow.authorize_exists === true;
  result.hasPermissionExists = helperRow.has_permission_exists === true;
  result.hasOrgPermissionExists = helperRow.has_org_permission_exists === true;
  result.currentProjectClaimsExists = helperRow.current_project_claims_exists === true;
  result.currentPermissionClaimsExists = helperRow.current_permission_claims_exists === true;
  result.legacyWebhooksAbsent = helperRow.legacy_webhooks_absent === true;
  result.legacyWebhookDeliveriesAbsent = helperRow.legacy_webhook_deliveries_absent === true;
  result.authorizeGranted = helperRow.authorize_granted === true;
  result.hasPermissionGranted = helperRow.has_permission_granted === true;
  result.hasOrgPermissionGranted = helperRow.has_org_permission_granted === true;
  result.currentProjectClaimsGranted = helperRow.current_project_claims_granted === true;
  result.currentPermissionClaimsGranted = helperRow.current_permission_claims_granted === true;
  result.currentPermissionClaimsPublicRevoked = helperRow.current_permission_claims_public_revoked === true;
  result.currentPermissionClaimsAnonRevoked = helperRow.current_permission_claims_anon_revoked === true;
  result.currentPermissionClaimsSecurityDefiner = helperRow.current_permission_claims_security_definer === true;
  result.currentPermissionClaimsSearchPathHardened = helperRow.current_permission_claims_search_path_hardened === true;

  // RB-7：扫描 RLS 策略，发现把 JWT role claim 当作业务权限的不安全模式。
  const pattern = String.raw`request\.jwt\.claim\.role|auth\.jwt\(\)\s*->>\s*'role'`;
  const unsafe = await sql`
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE qual ~* ${pattern} OR with_check ~* ${pattern}`;
  const unsafeRows = unsafe as unknown as Array<Record<string, unknown>>;
  result.unsafePolicies = unsafeRows.map((row) => ({
    schemaname: String(row.schemaname ?? ''),
    tablename: String(row.tablename ?? ''),
    policyname: String(row.policyname ?? ''),
    qual: (row.qual as string | null) ?? null,
    with_check: (row.with_check as string | null) ?? null,
  }));

  return result;
}

export async function verifyRbacAgainstDatabase(databaseUrl?: string): Promise<RbacDbVerification> {
  const url = databaseUrl || process.env.SUPACLOUD_DATABASE_URL || process.env.SUPABASE_DB_URL || '';
  if (!url) return { reachable: false };

  const sql = postgres(url, {
    max: 1,
    connect_timeout: CONNECT_TIMEOUT_SEC,
    idle_timeout: 5,
    connection: { application_name: 'supaoauth-install-verify' },
  });

  // 用整体预算包住探测，超时则强制结束连接并回退为不可达。
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<RbacDbVerification>((resolve) => {
    timer = setTimeout(
      () => resolve({ reachable: false, error: `RBAC verification timed out after ${PROBE_BUDGET_MS}ms` }),
      PROBE_BUDGET_MS,
    );
  });

  try {
    return await Promise.race([probe(sql), budget]);
  } catch (e) {
    return { reachable: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (timer) clearTimeout(timer);
    await sql.end({ timeout: 3 }).catch(() => {});
  }
}
