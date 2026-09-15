// @ts-check
import { isUnknownArray } from './unknown-value.js';
export const GOTRUE_OAUTH_GRANT_TYPES = Object.freeze([
  "authorization_code",
  "refresh_token",
]);

const supportedGrantTypes = new Set(GOTRUE_OAUTH_GRANT_TYPES);

/** @param {unknown} grantTypes @returns {string[]} */
export function supportedOAuthGrantTypes(grantTypes) {
  if (!isUnknownArray(grantTypes)) return [];
  return grantTypes.flatMap((grantType) =>
    typeof grantType === "string" && supportedGrantTypes.has(grantType) ? [grantType] : [],
  );
}
