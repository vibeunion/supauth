export function isOAuthAuthorizationNotFound(status: number, payload: unknown): boolean {
  if (status !== 404 || !payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const record = payload as Record<string, unknown>;
  return record['error_code'] === 'oauth_authorization_not_found'
    || record['code'] === 'oauth_authorization_not_found';
}
