import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  customUiActionAllowed,
  customUiMutationTarget,
  customUiReadBackConfirms,
  customUiStatusReady,
} from "./custom-ui-reconciliation.js";

const consoleSource = readFileSync(
  new URL("../routes/sign-in-experience/custom-ui/+page.svelte", import.meta.url),
  "utf8",
);

function customUiStatus(status) {
  const blocked = status === "blocked_unsafe_origin";
  const cleanupPending = status === "cleanup_pending";
  return {
    status,
    assets_id: status === "disabled" ? null : "assets-a",
    configured: status !== "disabled",
    enabled: false,
    lifecycle_state: status === "disabled"
      ? null
      : blocked ? "active" : status,
    file_count: 0,
    files: [],
    cleanup_pending: cleanupPending,
    audit_pending: false,
  };
}

describe("Custom UI authoritative mutation read-back", () => {
  test("enables mutations only after a complete lifecycle status is loaded", () => {
    expect(customUiStatusReady(null)).toBe(false);
    expect(customUiStatusReady({})).toBe(false);
    expect(customUiStatusReady({ status: "unknown" })).toBe(false);
    expect(customUiStatusReady({
      status: "blocked_unsafe_origin",
      configured: true,
      enabled: false,
    })).toBe(false);
    expect(customUiStatusReady({
      status: "disabled",
      configured: false,
      enabled: false,
      assets_id: null,
      lifecycle_state: null,
      file_count: 0,
      files: [],
      cleanup_pending: false,
      audit_pending: false,
    })).toBe(true);
    expect(customUiStatusReady({
      ...customUiStatus("disabled"),
      audit_pending: true,
    })).toBe(false);
  });

  test("allows only lifecycle-compatible actions", () => {
    expect(customUiActionAllowed("upload", customUiStatus("disabled"))).toBe(false);
    expect(customUiActionAllowed("upload", customUiStatus("blocked_unsafe_origin"))).toBe(false);
    expect(customUiActionAllowed("upload", customUiStatus("cleanup_pending"))).toBe(false);
    expect(customUiActionAllowed("delete", customUiStatus("disabled"))).toBe(false);
    expect(customUiActionAllowed("delete", customUiStatus("blocked_unsafe_origin"))).toBe(true);
    expect(customUiActionAllowed("delete", customUiStatus("cleanup_pending"))).toBe(true);
    expect(customUiActionAllowed("unknown", customUiStatus("blocked_unsafe_origin"))).toBe(false);
    expect(customUiActionAllowed("upload", { status: "blocked_unsafe_origin" })).toBe(false);
  });

  test("never confirms an upload while the isolated origin is unavailable", () => {
    const target = customUiMutationTarget({
      status: "blocked_unsafe_origin",
      assets_id: "assets-a",
    });

    expect(customUiReadBackConfirms(
      "upload",
      target,
      customUiStatus("blocked_unsafe_origin"),
    )).toBe(false);
  });

  test("confirms blocked deletion after deactivation or complete removal", () => {
    const target = customUiMutationTarget({
      status: "blocked_unsafe_origin",
      assets_id: "assets-a",
    });

    expect(customUiReadBackConfirms("delete", target, {
      status: "cleanup_pending",
      assets_id: "assets-a",
      configured: true,
      enabled: false,
      lifecycle_state: "cleanup_pending",
      file_count: 0,
      files: [],
      cleanup_pending: true,
      audit_pending: false,
    })).toBe(true);
    expect(customUiReadBackConfirms("delete", target, {
      status: "disabled",
      configured: false,
      enabled: false,
      assets_id: null,
      lifecycle_state: null,
      file_count: 0,
      files: [],
      cleanup_pending: false,
      audit_pending: false,
    })).toBe(true);
  });

  test("does not mistake a pre-existing cleanup state for a completed retry", () => {
    const target = customUiMutationTarget({
      status: "cleanup_pending",
      assets_id: "assets-a",
    });

    expect(customUiReadBackConfirms("delete", target, {
      status: "cleanup_pending",
      assets_id: "assets-a",
      configured: true,
      enabled: false,
      lifecycle_state: "cleanup_pending",
      file_count: 0,
      files: [],
      cleanup_pending: true,
      audit_pending: false,
    })).toBe(false);
    expect(customUiReadBackConfirms("delete", target, {
      status: "cleanup_pending",
      assets_id: "assets-b",
      configured: true,
      enabled: false,
      lifecycle_state: "cleanup_pending",
      file_count: 0,
      files: [],
      cleanup_pending: true,
      audit_pending: false,
    })).toBe(false);
    expect(customUiReadBackConfirms("delete", "invalid-target", {
      status: "disabled",
      configured: false,
      enabled: false,
      assets_id: null,
      lifecycle_state: null,
      file_count: 0,
      files: [],
      cleanup_pending: false,
      audit_pending: false,
    })).toBe(false);
  });

  test("persists a lock before each mutation and fails closed without status", () => {
    const deleteStart = consoleSource.indexOf("async function removeCustomUi");
    const reconcileStart = consoleSource.indexOf("async function reconcileStatus");
    const beginMutationStart = consoleSource.indexOf("function beginMutation");
    const beginMutationEnd = consoleSource.indexOf("async function reconcileLockedMutation");
    const deleteSource = consoleSource.slice(deleteStart, reconcileStart);
    const beginMutationSource = consoleSource.slice(beginMutationStart, beginMutationEnd);

    expect(consoleSource).toContain("createDurableMutationLockStore");
    expect(consoleSource).toContain("restoreMutationLocks();");
    expect(consoleSource).toContain(
      "&& customUiActionAllowed(action, customUiStatus);",
    );
    expect(deleteSource).toContain('!mutationAllowed("delete")');
    expect(deleteSource).toContain('beginMutation("delete")');
    expect(consoleSource).toContain('disabled={!mutationAllowed("delete")}');
    expect(consoleSource).not.toContain("uploadCustomUiAssets");
    expect(consoleSource).not.toContain('type="file"');
    expect(consoleSource).not.toContain("globalThis.location.origin");
    expect(beginMutationSource).toContain("stageMutation(action, targetId)");
    expect(deleteSource.indexOf('beginMutation("delete")')).toBeLessThan(
      deleteSource.indexOf("deleteCustomUiAssets()"),
    );
  });
});
