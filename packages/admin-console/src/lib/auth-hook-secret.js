const STANDARD_WEBHOOK_PREFIX = "v1,whsec_";

export function normalizeAuthHookSecret(secret) {
  const trimmedSecret = secret.trim();
  if (!trimmedSecret) return "";
  const encodedKey = trimmedSecret.startsWith(STANDARD_WEBHOOK_PREFIX)
    ? trimmedSecret.slice(STANDARD_WEBHOOK_PREFIX.length)
    : trimmedSecret;
  if (
    encodedKey.length < 32 ||
    encodedKey.length > 88 ||
    encodedKey.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encodedKey)
  ) return null;
  const signingKey = Buffer.from(encodedKey, "base64");
  if (
    signingKey.length < 24 ||
    signingKey.length > 64 ||
    signingKey.toString("base64") !== encodedKey
  ) return null;
  return `${STANDARD_WEBHOOK_PREFIX}${encodedKey}`;
}
