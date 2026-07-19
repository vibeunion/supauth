export const GOTRUE_OAUTH_GRANT_TYPES = Object.freeze([
  "authorization_code",
  "refresh_token",
]);

const supportedGrantTypes = new Set(GOTRUE_OAUTH_GRANT_TYPES);

export function supportedOAuthGrantTypes(grantTypes) {
  if (!Array.isArray(grantTypes)) return [];
  return grantTypes.filter((grantType) => supportedGrantTypes.has(grantType));
}
