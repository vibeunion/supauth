import { describe, expect, test } from "bun:test";
import type { AdminEndpointResult } from "@supauth/shared";
import { AdminApiError } from "./admin-api.js";
import { deleteCustomUiCommand } from "./custom-ui-command.js";
import { customUiMutationTarget } from "./custom-ui-reconciliation.js";

type Status = AdminEndpointResult<"getCustomUiStatus">;
const blocked: Status = {
  status: "blocked_unsafe_origin", configured: true, enabled: false,
  lifecycle_state: "active", assets_id: "assets-a", content_sha256: null,
  uploaded_at: null, file_count: 0, files: [], cleanup_pending: false, audit_pending: false,
};
const removed: Status = {
  ...blocked, status: "disabled", configured: false, lifecycle_state: null, assets_id: null,
};
const pending: Status = {
  ...blocked, status: "cleanup_pending", lifecycle_state: "cleanup_pending",
  cleanup_pending: true, audit_pending: true,
};
const acknowledgement = {
  status: "deleted", deleted_file_count: 0,
} satisfies AdminEndpointResult<"deleteCustomUiAssets">;
const input = { targetId: customUiMutationTarget(blocked), status: blocked };

function setup(
  write: () => Promise<unknown> = async () => acknowledgement,
  read: () => Promise<unknown> = async () => removed,
) {
  const calls = { write: 0, read: 0 };
  return {
    calls,
    transport: {
      deleteAssets() { calls.write++; return write(); },
      readStatus() { calls.read++; return read(); },
    },
  };
}

describe("custom UI contract DELETE", () => {
  test("valid acknowledgement waits for delayed authoritative readback", async () => {
    const authority = Promise.withResolvers<unknown>();
    const started = Promise.withResolvers<void>();
    const probe = setup(undefined, () => {
      started.resolve();
      return authority.promise;
    });
    let finished = false;
    const execution = deleteCustomUiCommand(input, probe.transport).then((result) => {
      finished = true;
      return result;
    });
    await started.promise;
    expect(finished).toBe(false);
    expect(probe.calls).toEqual({ write: 1, read: 1 });
    authority.resolve(removed);
    const result = await execution;
    expect(result.kind).toBe("confirmed");
    if (result.kind !== "confirmed") throw new Error("Expected confirmation");
    expect(result.authority).toEqual(removed);
    expect(result.acknowledgement).toEqual(acknowledgement);
    expect(result.writeError).toBeNull();
    expect(probe.calls).toEqual({ write: 1, read: 1 });
  });

  test.each([
    new AdminApiError("Read forbidden", 403),
    new AdminApiError("Read failed", 500),
    new AdminApiError("Read timeout", 408, "request_timeout"),
    new Error("Unknown read failure"),
  ])("a rejected GET is cached, never classified as write denial: %s", async (error) => {
    const probe = setup(undefined, async () => { throw error; });
    const result = await deleteCustomUiCommand(input, probe.transport);
    expect(result.kind).toBe("unknown");
    if (result.kind !== "unknown") throw new Error("Expected unknown");
    expect(result.readError).toBe(error);
    expect(result.writeError).toBeNull();
    expect(probe.calls).toEqual({ write: 1, read: 1 });
  });

  test("synchronously throwing reads are also cached", async () => {
    const error = new Error("Synchronous read failure");
    const probe = setup(undefined, () => { throw error; });
    const result = await deleteCustomUiCommand(input, probe.transport);
    expect(result.kind).toBe("unknown");
    if (result.kind !== "unknown") throw new Error("Expected unknown");
    expect(result.readError).toBe(error);
    expect(probe.calls).toEqual({ write: 1, read: 1 });
  });

  test.each([
    new AdminApiError("Timeout", 408, "request_timeout"),
    new AdminApiError("Aborted", 0, "request_aborted"),
    new AdminApiError("Internal error", 500),
    new AdminApiError("Invalid response", 502, "invalid_upstream_response"),
    new TypeError("Network failure"),
    new Error("Unrecognized failure"),
  ])("uncertain DELETE uses authority without replay: %s", async (error) => {
    const probe = setup(async () => { throw error; });
    const result = await deleteCustomUiCommand(input, probe.transport);
    expect(result.kind).toBe("confirmed");
    if (result.kind !== "confirmed") throw new Error("Expected confirmation");
    expect(result.writeError).toBe(error);
    expect(result.acknowledgement).toBeNull();
    expect(probe.calls).toEqual({ write: 1, read: 1 });
  });

  test.each([401, 403])("explicit write denial %s has no readback", async (code) => {
    const error = new AdminApiError("Denied", code);
    const probe = setup(async () => { throw error; });
    expect(await deleteCustomUiCommand(input, probe.transport)).toEqual({ kind: "denied", error });
    expect(probe.calls).toEqual({ write: 1, read: 0 });
  });

  test.each([400, 404, 409, 422])("other HTTP %s cannot authorize unlock", async (code) => {
    const error = new AdminApiError("Unproven rejection stage", code);
    const probe = setup(async () => { throw error; }, async () => blocked);
    const result = await deleteCustomUiCommand(input, probe.transport);
    expect(result.kind).toBe("unknown");
    expect(probe.calls).toEqual({ write: 1, read: 1 });
  });

  test.each([true, false])("409 after an effect requires matching authority: %s", async (matches) => {
    let effect = false;
    const error = new AdminApiError("Changed", 409, "custom_ui_changed_retry");
    const probe = setup(async () => {
      effect = true;
      throw error;
    }, async () => {
      expect(effect).toBe(true);
      return matches ? pending : { ...pending, assets_id: "assets-b" };
    });
    const result = await deleteCustomUiCommand(input, probe.transport);
    expect(result.kind).toBe(matches ? "confirmed" : "unknown");
    expect(probe.calls).toEqual({ write: 1, read: 1 });
  });

  test("unrecognized write and read errors remain separate and unknown", async () => {
    const writeError = new Error("Unknown write");
    const readError = new AdminApiError("Read forbidden", 403);
    const probe = setup(async () => { throw writeError; }, async () => { throw readError; });
    const result = await deleteCustomUiCommand(input, probe.transport);
    expect(result.kind).toBe("unknown");
    if (result.kind !== "unknown") throw new Error("Expected unknown");
    expect(result.writeError).toBe(writeError);
    expect(result.readError).toBe(readError);
    expect(probe.calls).toEqual({ write: 1, read: 1 });
  });

  test.each([
    null, {}, { ...input, targetId: "bad" },
    { ...input, targetId: "blocked_unsafe_origin:assets-b" },
    { ...input, status: removed },
    { ...input, status: { ...blocked, file_count: 1 } },
  ])("invalid input never writes or reads: %j", async (value) => {
    const probe = setup();
    expect((await deleteCustomUiCommand(value, probe.transport)).kind).toBe("invalid");
    expect(probe.calls).toEqual({ write: 0, read: 0 });
  });

  test.each([
    {}, { ...removed, uploaded_at: undefined },
    { ...removed, audit_pending: true },
    { ...removed, file_count: 1 },
    { ...pending, assets_id: "assets-b" },
    { ...blocked, files: Array.from({ length: 1 }, () => ({})), file_count: 1 },
    blocked,
  ])("invalid or mismatched authority never confirms or triggers a second GET: %j", async (status) => {
    const probe = setup(undefined, async () => status);
    expect((await deleteCustomUiCommand(input, probe.transport)).kind).toBe("unknown");
    expect(probe.calls).toEqual({ write: 1, read: 1 });
  });

  test.each([true, false])("malformed ack requires authority: %s", async (matches) => {
    const probe = setup(async () => ({ status: "deleted" }), async () => matches ? removed : blocked);
    const result = await deleteCustomUiCommand(input, probe.transport);
    expect(result.kind).toBe(matches ? "confirmed" : "unknown");
    if (result.kind !== "confirmed" && result.kind !== "unknown") throw new Error("Expected readback");
    expect(result.acknowledgement).toBeNull();
    expect(result.writeError).toBeInstanceOf(Error);
    expect(probe.calls).toEqual({ write: 1, read: 1 });
  });

  test("existing cleanup_pending is not a completed retry", async () => {
    const probe = setup(undefined, async () => pending);
    const result = await deleteCustomUiCommand({
      targetId: customUiMutationTarget(pending), status: pending,
    }, probe.transport);
    expect(result.kind).toBe("unknown");
    expect(probe.calls).toEqual({ write: 1, read: 1 });
  });

  test("deactivation acknowledgement is preserved after matching readback", async () => {
    const ack = {
      status: "deactivated", deleted_file_count: 0, cleanup_pending: true, audit_pending: true,
    } satisfies AdminEndpointResult<"deleteCustomUiAssets">;
    const probe = setup(async () => ack, async () => pending);
    const result = await deleteCustomUiCommand(input, probe.transport);
    expect(result.kind).toBe("confirmed");
    if (result.kind !== "confirmed") throw new Error("Expected confirmation");
    expect(result.acknowledgement).toEqual(ack);
  });

  test("separate invocations never share a previous read promise", async () => {
    const probe = setup();
    await deleteCustomUiCommand(input, probe.transport);
    await deleteCustomUiCommand(input, probe.transport);
    expect(probe.calls).toEqual({ write: 2, read: 2 });
  });

  test("readback always matches the original target despite caller mutation", async () => {
    const write = Promise.withResolvers<unknown>();
    const mutableInput = { ...input };
    const probe = setup(() => write.promise, async () => ({ ...pending, assets_id: "assets-b" }));
    const execution = deleteCustomUiCommand(mutableInput, probe.transport);
    mutableInput.targetId = "blocked_unsafe_origin:assets-b";
    write.resolve(acknowledgement);
    expect((await execution).kind).toBe("unknown");
    expect(probe.calls).toEqual({ write: 1, read: 1 });
  });
});
