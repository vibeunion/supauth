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

function statusLabelKey(status, statusKeys, fallbackKey) {
  return typeof status === "string" && Object.hasOwn(statusKeys, status)
    ? statusKeys[status]
    : fallbackKey;
}

export function auditIntegrityStatusLabelKey(integrity) {
  if (integrity?.consistent === true && integrity?.status === "verified") {
    return "audit.integrityStatus.verified";
  }
  return statusLabelKey(
    integrity?.status,
    INTEGRITY_STATUS_KEYS,
    "audit.integrityStatus.reviewRequired",
  );
}

export function auditExportStatusLabelKey(status) {
  return statusLabelKey(status, EXPORT_STATUS_KEYS, "audit.exportStatus.unknown");
}
