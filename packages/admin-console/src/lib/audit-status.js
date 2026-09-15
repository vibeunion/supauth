// @ts-check
const INTEGRITY_STATUS_KEYS = {
  mismatch: "audit.integrityStatus.mismatch",
  legacy_unverified: "audit.integrityStatus.legacyUnverified",
};

const EXPORT_STATUS_KEYS = {
  pending: "audit.exportStatus.pending",
  queued: "audit.exportStatus.queued",
  processing: "audit.exportStatus.processing",
  completed: "audit.exportStatus.completed",
  failed: "audit.exportStatus.failed",
  expired: "audit.exportStatus.expired",
};

/** @param {unknown} status @param {Readonly<Record<string, string>>} statusKeys @param {string} fallbackKey */
function statusLabelKey(status, statusKeys, fallbackKey) {
  return typeof status === "string" && Object.hasOwn(statusKeys, status)
    ? statusKeys[status] ?? fallbackKey
    : fallbackKey;
}

/** @param {unknown} integrity */
export function auditIntegrityStatusLabelKey(integrity) {
  if (!integrity || typeof integrity !== "object") return "audit.integrityStatus.reviewRequired";
  if ("consistent" in integrity && integrity.consistent === true && "status" in integrity && integrity.status === "verified") {
    return "audit.integrityStatus.verified";
  }
  return statusLabelKey(
    "status" in integrity ? integrity.status : undefined,
    INTEGRITY_STATUS_KEYS,
    "audit.integrityStatus.reviewRequired",
  );
}

/** @param {unknown} status */
export function auditExportStatusLabelKey(status) {
  return statusLabelKey(status, EXPORT_STATUS_KEYS, "audit.exportStatus.unknown");
}
