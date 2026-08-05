export function customUiAssetIdentity(status) {
  return status?.assets_id || "default-ui";
}

export function customUiMutationTarget(status) {
  return `${status?.status || "disabled"}:${customUiAssetIdentity(status)}`;
}

function customUiStatusFilesReady(status) {
  if (!Number.isSafeInteger(status?.file_count) || status.file_count < 0) return false;
  if (!Array.isArray(status.files) || status.files.length !== status.file_count) return false;
  return status.files.every((file) => (
    file
    && typeof file === "object"
    && typeof file.path === "string"
    && file.path.length > 0
    && typeof file.sha256 === "string"
    && /^[a-f0-9]{64}$/.test(file.sha256)
    && Number.isSafeInteger(file.size)
    && file.size >= 0
    && typeof file.content_type === "string"
  ));
}

function customUiLifecycleReady(status) {
  if (status.status === "blocked_unsafe_origin") {
    return status.lifecycle_state === "active";
  }
  return status.status === "cleanup_pending"
    && ["cleanup_pending", "objects_deleted"].includes(status.lifecycle_state);
}

export function customUiStatusReady(status) {
  if (
    typeof status?.configured !== "boolean"
    || typeof status?.enabled !== "boolean"
    || typeof status?.cleanup_pending !== "boolean"
    || typeof status?.audit_pending !== "boolean"
    || !customUiStatusFilesReady(status)
  ) return false;
  if (status.status === "disabled") {
    return !status.configured
      && !status.enabled
      && !status.cleanup_pending
      && !status.audit_pending
      && status.assets_id === null
      && status.lifecycle_state === null
      && status.file_count === 0;
  }
  if (
    status.status !== "blocked_unsafe_origin"
    && status.status !== "cleanup_pending"
  ) return false;
  return status.configured
    && typeof status.assets_id === "string"
    && status.assets_id.length > 0
    && !status.enabled
    && customUiLifecycleReady(status);
}

export function customUiActionAllowed(action, status) {
  if (!customUiStatusReady(status)) return false;
  if (action === "upload") return false;
  if (action === "delete") {
    return status.status === "blocked_unsafe_origin"
      || status.status === "cleanup_pending";
  }
  return false;
}

function mutationTargetParts(targetId) {
  if (typeof targetId !== "string") return null;
  const separator = targetId.indexOf(":");
  if (separator <= 0 || separator === targetId.length - 1) return null;
  const state = targetId.slice(0, separator);
  // active 仅用于识别升级前已落盘的锁；新状态不会再返回 active。
  if (![
    "active",
    "blocked_unsafe_origin",
    "cleanup_pending",
    "disabled",
  ].includes(state)) return null;
  return { state, assetsId: targetId.slice(separator + 1) };
}

export function customUiReadBackConfirms(action, targetId, status) {
  const target = mutationTargetParts(targetId);
  if (
    (action !== "upload" && action !== "delete")
    || !target
    || !customUiStatusReady(status)
  ) return false;
  if (action === "upload") return false;
  if (status?.status === "disabled") return true;
  return ["active", "blocked_unsafe_origin"].includes(target.state)
    && status?.status === "cleanup_pending"
    && customUiAssetIdentity(status) === target.assetsId;
}
