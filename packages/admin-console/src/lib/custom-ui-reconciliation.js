// @ts-check
import { isUnknownArray } from './unknown-value.js';
/** @typedef {Pick<import("@supauth/shared").AdminEndpointResult<"getCustomUiStatus">, "status" | "configured" | "enabled" | "cleanup_pending" | "audit_pending" | "assets_id" | "lifecycle_state" | "file_count" | "files">} CustomUiAuthority */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} status */
export function customUiAssetIdentity(status) {
  return isRecord(status) && typeof status["assets_id"] === "string" && status["assets_id"]
    ? status["assets_id"] : "default-ui";
}

/** @param {unknown} status */
export function customUiMutationTarget(status) {
  const state = isRecord(status) && typeof status["status"] === "string" && status["status"]
    ? status["status"] : "disabled";
  return `${state}:${customUiAssetIdentity(status)}`;
}

/** @param {Record<string, unknown>} status */
function customUiStatusFilesReady(status) {
  if (typeof status["file_count"] !== "number" || !Number.isSafeInteger(status["file_count"]) || status["file_count"] < 0) return false;
  if (!isUnknownArray(status["files"]) || status["files"].length !== status["file_count"]) return false;
  return Array.from(status["files"]).every((file) => (
    isRecord(file)
    && typeof file["path"] === "string"
    && file["path"].length > 0
    && typeof file["sha256"] === "string"
    && /^[a-f0-9]{64}$/.test(file["sha256"])
    && typeof file["size"] === "number"
    && Number.isSafeInteger(file["size"])
    && file["size"] >= 0
    && typeof file["content_type"] === "string"
  ));
}

/** @param {Record<string, unknown>} status */
function customUiLifecycleReady(status) {
  if (status["status"] === "blocked_unsafe_origin") {
    return status["lifecycle_state"] === "active";
  }
  return status["status"] === "cleanup_pending"
    && typeof status["lifecycle_state"] === "string"
    && ["cleanup_pending", "objects_deleted"].includes(status["lifecycle_state"]);
}

/** @param {unknown} status @returns {status is CustomUiAuthority} */
export function customUiStatusReady(status) {
  if (!isRecord(status)) return false;
  if (
    typeof status?.["configured"] !== "boolean"
    || typeof status?.["enabled"] !== "boolean"
    || typeof status?.["cleanup_pending"] !== "boolean"
    || typeof status?.["audit_pending"] !== "boolean"
    || !customUiStatusFilesReady(status)
  ) return false;
  if (status["status"] === "disabled") {
    return !status["configured"]
      && !status["enabled"]
      && !status["cleanup_pending"]
      && !status["audit_pending"]
      && status["assets_id"] === null
      && status["lifecycle_state"] === null
      && status["file_count"] === 0;
  }
  if (
    status["status"] !== "blocked_unsafe_origin"
    && status["status"] !== "cleanup_pending"
  ) return false;
  return status["configured"]
    && typeof status["assets_id"] === "string"
    && status["assets_id"].length > 0
    && !status["enabled"]
    && customUiLifecycleReady(status);
}

/** @param {unknown} action @param {unknown} status */
export function customUiActionAllowed(action, status) {
  if (!customUiStatusReady(status)) return false;
  if (action === "upload") return false;
  if (action === "delete") {
    return status.status === "blocked_unsafe_origin"
      || status.status === "cleanup_pending";
  }
  return false;
}

/** @param {unknown} targetId */
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

/** @param {unknown} action @param {unknown} targetId @param {unknown} status */
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
