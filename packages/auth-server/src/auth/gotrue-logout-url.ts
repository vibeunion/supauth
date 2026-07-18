type GoTrueEnvironment = Record<string, string | undefined>;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function buildGoTrueLogoutUrl(baseUrl: string): string {
  const normalized = trimTrailingSlash(baseUrl.trim());
  if (!normalized) return '';
  if (normalized.endsWith('/auth/v1/logout') || normalized.endsWith('/logout')) {
    return normalized;
  }
  return normalized.endsWith('/auth/v1')
    ? `${normalized}/logout`
    : `${normalized}/auth/v1/logout`;
}

export function resolveGoTrueLogoutUrl(env: GoTrueEnvironment = process.env): string {
  const baseUrl = env.GOTRUE_LOGOUT_URL
    || env.OAUTH_RUNTIME_URL
    || env.SUPACLOUD_RUNTIME_URL
    || env.SUPABASE_URL
    || '';
  return buildGoTrueLogoutUrl(baseUrl);
}
