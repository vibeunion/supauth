import postgres from 'postgres';

export interface AdminSsoAllowlistVerification {
  emailCount: number;
  domainCount: number;
}

interface AdminSsoAllowlistCountRow {
  email_count: number | string;
  domain_count: number | string;
}

const CONNECT_TIMEOUT_SEC = 3;

function allowlistCount(rawCount: number | string, countKind: string) {
  const count = Number(rawCount);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Admin SSO allowlist verifier returned an invalid ${countKind} count`);
  }
  return count;
}

export function adminSsoAllowlistCountsFromRow(
  row?: AdminSsoAllowlistCountRow,
): AdminSsoAllowlistVerification {
  if (!row) return { emailCount: 0, domainCount: 0 };
  return {
    emailCount: allowlistCount(row.email_count, 'email'),
    domainCount: allowlistCount(row.domain_count, 'domain'),
  };
}

export async function verifyAdminSsoAllowlist(databaseUrl: string): Promise<AdminSsoAllowlistVerification> {
  if (!databaseUrl) throw new Error('SUPACLOUD_DATABASE_URL is required for Admin SSO allowlist verification');

  const sql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: CONNECT_TIMEOUT_SEC,
    idle_timeout: 5,
    connection: { application_name: 'supaoauth-admin-sso-install-verify' },
  });

  try {
    const rows = await sql<AdminSsoAllowlistCountRow[]>`
      SELECT
        jsonb_array_length(COALESCE(admin_allowed_emails, '[]'::jsonb))::integer AS email_count,
        jsonb_array_length(COALESCE(admin_allowed_domains, '[]'::jsonb))::integer AS domain_count
      FROM supaoauth.security_config
      LIMIT 1`;
    return adminSsoAllowlistCountsFromRow(rows[0]);
  } finally {
    await sql.end({ timeout: 3 });
  }
}
