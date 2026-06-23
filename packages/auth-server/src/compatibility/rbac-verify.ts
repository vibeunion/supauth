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
  hasOrgPermissionExists?: boolean;
  authorizeGranted?: boolean;
  hasOrgPermissionGranted?: boolean;
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

  // RB-1 / RB-2：supaoauth schema 下两个授权辅助函数是否存在。
  const fns = await sql`
    SELECT p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'supaoauth'
      AND p.proname IN ${sql(['authorize', 'has_org_permission'])}`;
  const fnRows = fns as unknown as Array<{ proname: string }>;
  const names = new Set(fnRows.map((row) => row.proname));
  result.authorizeExists = names.has('authorize');
  result.hasOrgPermissionExists = names.has('has_org_permission');

  // RB-3：authenticated 角色是否被授予 EXECUTE（函数缺失时返回 NULL，视为未授权）。
  const grants = await sql`
    SELECT
      has_function_privilege('authenticated', 'supaoauth.authorize(TEXT, UUID)', 'EXECUTE')  AS authorize,
      has_function_privilege('authenticated', 'supaoauth.has_org_permission(UUID, TEXT)', 'EXECUTE') AS has_org_permission`;
  const grantRow = ((grants as unknown as Array<{ authorize: boolean | null; has_org_permission: boolean | null }>)[0] ?? { authorize: null, has_org_permission: null });
  result.authorizeGranted = grantRow.authorize === true;
  result.hasOrgPermissionGranted = grantRow.has_org_permission === true;

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
