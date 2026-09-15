// @ts-check
/** @param {unknown} candidate @returns {candidate is Record<string, unknown>} */
function isRecord(candidate) {
  return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);
}

/** @param {unknown} candidate */
export function parseAuthHookStatus(candidate) {
  if (
    !isRecord(candidate)
    || typeof candidate["registered"] !== "boolean"
    || typeof candidate["verified"] !== "boolean"
    || (candidate["verified"] && !candidate["registered"])
  ) return null;
  const reasonCode = candidate["reason_code"] ?? null;
  if (reasonCode !== null && (typeof reasonCode !== "string" || !reasonCode.trim())) return null;
  return {
    registered: candidate["registered"],
    verified: candidate["verified"],
    reason_code: reasonCode,
  };
}

/** @param {unknown} status */
export function authHookStatusIsActive(status) {
  return isRecord(status) && status["registered"] === true && status["verified"] === true;
}
