function isRecord(candidate) {
  return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);
}

export function parseAuthHookStatus(candidate) {
  if (
    !isRecord(candidate)
    || typeof candidate.registered !== "boolean"
    || typeof candidate.verified !== "boolean"
    || (candidate.verified && !candidate.registered)
  ) return null;
  const reasonCode = candidate.reason_code ?? null;
  if (reasonCode !== null && (typeof reasonCode !== "string" || !reasonCode.trim())) return null;
  return {
    registered: candidate.registered,
    verified: candidate.verified,
    reason_code: reasonCode,
  };
}

export function authHookStatusIsActive(status) {
  return status?.registered === true && status?.verified === true;
}
