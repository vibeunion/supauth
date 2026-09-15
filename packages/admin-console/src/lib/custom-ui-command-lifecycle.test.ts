import { describe, expect, test } from "bun:test";
import { adminEndpoints, decodeSchema, type AdminEndpointResult } from "@supauth/shared";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import ts from "typescript";
import { extractSvelteSafetyRegions } from "../../scripts/static-safety-svelte.js";
import { AdminApiError } from "./admin-api.js";
import { deleteCustomUiCommand, type CustomUiDeleteOutcome } from "./custom-ui-command.js";
import {
  customUiActionAllowed, customUiMutationTarget, customUiReadBackConfirms, customUiStatusReady,
} from "./custom-ui-reconciliation.js";
import {
  createDurableMutationLockStore, type DurableMutationLocks,
} from "./mutation-reconciliation.js";

type Status = AdminEndpointResult<"getCustomUiStatus">;
type MutationAction = "delete" | "upload";
const blocked = decodeSchema(adminEndpoints.getCustomUiStatus.result, {
  status: "blocked_unsafe_origin", configured: true, enabled: false,
  lifecycle_state: "active", assets_id: "lifecycle-assets-a", content_sha256: null,
  uploaded_at: null, file_count: 0, files: [], cleanup_pending: false, audit_pending: false,
});
const removed = decodeSchema(adminEndpoints.getCustomUiStatus.result, {
  ...blocked, status: "disabled", configured: false, lifecycle_state: null, assets_id: null,
});
const acknowledgement = decodeSchema(adminEndpoints.deleteCustomUiAssets.result, {
  status: "deleted", deleted_file_count: 0,
});

const pageSource = readFileSync(
  new URL("../routes/sign-in-experience/custom-ui/+page.svelte", import.meta.url), "utf8",
);
const instance = extractSvelteSafetyRegions(pageSource, "custom-ui/+page.svelte")
  .scripts.find((script) => script.kind === "instance");
if (!instance) throw new Error("Missing Custom UI instance script");
const pageScript = ts.createSourceFile("custom-ui.ts", instance.text, ts.ScriptTarget.Latest, true);
const extracted = [
  ...["CUSTOM_UI_LOCK_OWNER", "customUiMutationLockStore", "pageDisposed"].map((name) => {
    const statement = pageScript.statements.find((node) =>
      ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) =>
        ts.isIdentifier(declaration.name) && declaration.name.text === name));
    if (!statement) throw new Error(`Missing actual page declaration ${name}`);
    return statement.getText(pageScript);
  }),
  ...[
    "updateMutationLocks", "restoreMutationLocks", "mutationDescriptor", "stageMutation",
    "clearMutation", "mutationAllowed", "beginMutation", "removeCustomUi",
    "readCustomUiStatus", "beginReconciliation", "clearConfirmedMutations", "reconcileStatus",
  ].map((name) => {
    const declaration = pageScript.statements.find((node) =>
      ts.isFunctionDeclaration(node) && node.name?.text === name);
    if (!declaration) throw new Error(`Missing actual page function ${name}`);
    return declaration.getText(pageScript);
  }),
];
const mount = pageScript.statements.find((node) =>
  ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "onMount");
if (!mount) throw new Error("Missing actual onMount callback");
const compiled = ts.transpileModule(`${extracted.join("\n")}
${mount.getText(pageScript)}
capture({
  remove: removeCustomUi,
  reconcile: reconcileStatus,
  stage: () => stageMutation("delete", customUiMutationTarget(customUiStatus)),
  clear: () => clearMutation("delete", customUiMutationTarget(customUiStatus)),
  disposed: () => pageDisposed,
});
`, {
  compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  reportDiagnostics: true,
});
if (compiled.diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
  throw new Error("Invalid extracted Custom UI lifecycle code");
}

function memoryStorage() {
  const values = new Map<string, string>();
  const writes: { key: string; value: string }[] = [];
  return {
    writes,
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) {
      values.set(key, value);
      writes.push({ key, value });
    },
    snapshot() { return Object.fromEntries(values); },
  };
}

interface PageControls {
  remove(): Promise<void>;
  reconcile(): Promise<void>;
  stage(): boolean;
  clear(): boolean;
  disposed(): boolean;
}
interface PageState {
  customUiStatus: Status | null;
  mutating: boolean;
  mutationError: unknown;
  reconciliationError: unknown;
  mutationStorageError: unknown;
  mutationStorageReady: boolean;
  mutationLocks: DurableMutationLocks<MutationAction>;
  notice: string;
}

function pageInstance(storage: ReturnType<typeof memoryStorage>, scenario: {
  write?: () => Promise<unknown>;
  read?: () => Promise<unknown>;
  command?: typeof deleteCustomUiCommand;
} = {}) {
  const state: PageState = {
    customUiStatus: structuredClone(blocked), mutating: false,
    mutationError: null, reconciliationError: null, mutationStorageError: null,
    mutationStorageReady: false, mutationLocks: {}, notice: "",
  };
  const calls = { write: 0, read: 0, confirm: 0 };
  const updates: string[] = [];
  const writeArguments: unknown[][] = [];
  const readArguments: unknown[][] = [];
  let controls: PageControls | undefined;
  let cleanup: (() => void) | undefined;
  const context = {
    localStorage: storage,
    createDurableMutationLockStore,
    customUiActionAllowed, customUiMutationTarget, customUiReadBackConfirms, customUiStatusReady,
    onMount(callback: () => void | (() => void)) {
      const result = callback();
      if (typeof result !== "function") throw new Error("Missing actual page cleanup");
      cleanup = result;
    },
    capture(value: PageControls) { controls = value; },
    // 初始加载已完成；只替换挂载时的请求，不复制删除或手动确认控制流。
    loadStatus: async () => {},
    loading: false,
    get statusReady() { return customUiStatusReady(state.customUiStatus); },
    get outcomeUnknown() { return Object.keys(state.mutationLocks).length > 0; },
    get customUiStatus() { return state.customUiStatus; },
    set customUiStatus(value: unknown) {
      updates.push("customUiStatus");
      state.customUiStatus = value === null
        ? null : decodeSchema(adminEndpoints.getCustomUiStatus.result, structuredClone(value));
    },
    get mutating() { return state.mutating; },
    set mutating(value: boolean) { updates.push("mutating"); state.mutating = value; },
    get mutationError() { return state.mutationError; },
    set mutationError(value: unknown) { updates.push("mutationError"); state.mutationError = value; },
    get reconciliationError() { return state.reconciliationError; },
    set reconciliationError(value: unknown) {
      updates.push("reconciliationError"); state.reconciliationError = value;
    },
    get mutationStorageError() { return state.mutationStorageError; },
    set mutationStorageError(value: unknown) {
      updates.push("mutationStorageError"); state.mutationStorageError = value;
    },
    get mutationStorageReady() { return state.mutationStorageReady; },
    set mutationStorageReady(value: boolean) {
      updates.push("mutationStorageReady"); state.mutationStorageReady = value;
    },
    get mutationLocks() { return state.mutationLocks; },
    set mutationLocks(value: DurableMutationLocks<MutationAction>) {
      updates.push("mutationLocks"); state.mutationLocks = value;
    },
    get notice() { return state.notice; },
    set notice(value: string) { updates.push("notice"); state.notice = value; },
    t: (key: string) => key,
    confirm: (_message: string) => { calls.confirm++; return true; },
    deleteCustomUiAssets: (...args: unknown[]) => {
      calls.write++;
      writeArguments.push(structuredClone(args));
      return scenario.write ? scenario.write() : Promise.resolve(acknowledgement);
    },
    getCustomUiStatus: (...args: unknown[]) => {
      calls.read++;
      readArguments.push(structuredClone(args));
      return scenario.read ? scenario.read() : Promise.resolve(removed);
    },
    deleteCustomUiCommand: (value: unknown, transport: Parameters<typeof deleteCustomUiCommand>[1]) =>
      (scenario.command ?? deleteCustomUiCommand)(structuredClone(value), transport),
  };
  // 真实页面函数和生命周期在独立 realm 执行；每次挂载创建实际 store，共享同一存储。
  const executionResult: unknown = new Script(compiled.outputText).runInNewContext(context, { timeout: 1000 });
  if (executionResult !== undefined) throw new Error("Unexpected lifecycle setup result");
  if (controls === undefined || cleanup === undefined) throw new Error("Page did not mount");
  return { state, calls, updates, writeArguments, readArguments, controls, dispose: cleanup };
}

describe("Custom UI actual page lifecycle", () => {
  test("live page confirms with one write, one read and authentication retry disabled only for the write", async () => {
    const storage = memoryStorage();
    const page = pageInstance(storage);
    expect(page.controls.disposed()).toBe(false);
    await page.controls.remove();
    expect(page.calls).toEqual({ write: 1, read: 1, confirm: 1 });
    expect(page.writeArguments).toEqual([[{ authenticationRetry: "never" }]]);
    expect(page.readArguments).toEqual([[]]);
    expect(page.state.customUiStatus).toEqual(removed);
    expect(page.state.mutationLocks).toEqual({});
    expect(page.state.mutating).toBe(false);
    expect(page.state.mutationError).toBeNull();
    expect(page.state.notice).toBe("customUi.deleted");
    expect(storage.writes).toHaveLength(2);
    page.dispose();
    expect(page.controls.disposed()).toBe(true);
  });

  test("double interaction while authority is held cannot replay", async () => {
    const pending = Promise.withResolvers<unknown>();
    const started = Promise.withResolvers<void>();
    const page = pageInstance(memoryStorage(), { read: () => {
      started.resolve();
      return pending.promise;
    } });
    const first = page.controls.remove();
    await started.promise;
    await page.controls.remove();
    expect(page.calls).toEqual({ write: 1, read: 1, confirm: 1 });
    expect(page.state.mutating).toBe(true);
    expect(Object.keys(page.state.mutationLocks)).toHaveLength(1);
    pending.resolve(removed);
    await first;
    expect(page.state.mutationLocks).toEqual({});
  });

  test.each([true, false])("old held read cannot clear or overwrite a remounted page; succeeds=%s", async (succeeds) => {
    const storage = memoryStorage();
    const pending = Promise.withResolvers<unknown>();
    const started = Promise.withResolvers<void>();
    const oldPage = pageInstance(storage, { read: () => {
      started.resolve();
      return pending.promise;
    } });
    const execution = oldPage.controls.remove();
    await started.promise;
    expect(oldPage.calls).toEqual({ write: 1, read: 1, confirm: 1 });
    expect(Object.keys(oldPage.state.mutationLocks)).toHaveLength(1);
    oldPage.dispose();
    const oldState = structuredClone(oldPage.state);
    const oldUpdates = [...oldPage.updates];
    const saved = storage.snapshot();
    const savedWrites = [...storage.writes];
    const current = pageInstance(storage);
    current.state.notice = "Current instance";
    const currentState = structuredClone(current.state);
    await current.controls.remove();
    expect(current.calls).toEqual({ write: 0, read: 0, confirm: 0 });
    expect(Object.keys(current.state.mutationLocks)).toHaveLength(1);
    if (succeeds) pending.resolve(removed);
    else pending.reject(new AdminApiError("Old read forbidden", 403));
    await execution;
    expect(oldPage.state).toEqual(oldState);
    expect(oldPage.updates).toEqual(oldUpdates);
    expect(current.state).toEqual(currentState);
    expect(storage.snapshot()).toEqual(saved);
    expect(storage.writes).toEqual(savedWrites);
    const next = pageInstance(storage);
    expect(next.state.mutationLocks).toEqual(current.state.mutationLocks);
    await next.controls.remove();
    expect(next.calls.write).toBe(0);
  });

  test.each(["invalid", "denied"])("transport-free late %s outcome cannot clear a restored lock", async (kind) => {
    const storage = memoryStorage();
    const pending = Promise.withResolvers<CustomUiDeleteOutcome>();
    const oldPage = pageInstance(storage, { command: () => pending.promise });
    const execution = oldPage.controls.remove();
    oldPage.dispose();
    const before = structuredClone(oldPage.state);
    const updates = [...oldPage.updates];
    const saved = storage.snapshot();
    const writes = [...storage.writes];
    const current = pageInstance(storage);
    const outcome: CustomUiDeleteOutcome = kind === "denied"
      ? { kind: "denied", error: new AdminApiError("No active token", 401) }
      : { kind: "invalid", error: new Error("Input not admitted") };
    pending.resolve(outcome);
    await execution;
    expect(oldPage.calls.write).toBe(0);
    expect(oldPage.calls.read).toBe(0);
    expect(oldPage.state).toEqual(before);
    expect(oldPage.updates).toEqual(updates);
    expect(Object.keys(current.state.mutationLocks)).toHaveLength(1);
    expect(storage.snapshot()).toEqual(saved);
    expect(storage.writes).toEqual(writes);
  });

  test.each([true, false])("disposed catch and finally do not update state; synchronous rejection=%s", async (synchronous) => {
    const storage = memoryStorage();
    const error = new Error("Unexpected command rejection");
    const afterDispose: string[] = [];
    const page = pageInstance(storage, { command: () => {
      page.dispose();
      afterDispose.push(...page.updates);
      if (synchronous) throw error;
      return Promise.reject(error);
    } });
    await page.controls.remove();
    expect(page.controls.disposed()).toBe(true);
    expect(page.updates).toEqual(afterDispose);
    expect(page.state.mutating).toBe(true);
    expect(page.state.mutationError).toBeNull();
    expect(Object.keys(page.state.mutationLocks)).toHaveLength(1);
    expect(storage.writes).toHaveLength(1);
    expect(page.calls.write).toBe(0);
    expect(page.calls.read).toBe(0);
  });

  test("disposed entry cannot stage, request, or prompt even without an existing lock", async () => {
    const storage = memoryStorage();
    const page = pageInstance(storage);
    page.dispose();
    const before = [...page.updates];
    await page.controls.remove();
    expect(page.calls).toEqual({ write: 0, read: 0, confirm: 0 });
    expect(page.updates).toEqual(before);
    expect(storage.writes).toEqual([]);
  });

  test("old manual readback cannot clear the durable lock restored by a new page", async () => {
    const storage = memoryStorage();
    const pending = Promise.withResolvers<unknown>();
    const started = Promise.withResolvers<void>();
    const oldPage = pageInstance(storage, { read: () => {
      started.resolve();
      return pending.promise;
    } });
    expect(oldPage.controls.stage()).toBe(true);
    const execution = oldPage.controls.reconcile();
    await started.promise;
    oldPage.dispose();
    const current = pageInstance(storage);
    const currentState = structuredClone(current.state);
    const saved = storage.snapshot();
    const writes = [...storage.writes];
    pending.resolve(removed);
    await execution;
    expect(oldPage.calls).toEqual({ write: 0, read: 1, confirm: 0 });
    expect(oldPage.state.mutationLocks).toEqual(current.state.mutationLocks);
    expect(current.state).toEqual(currentState);
    expect(Object.keys(current.state.mutationLocks)).toHaveLength(1);
    expect(storage.snapshot()).toEqual(saved);
    expect(storage.writes).toEqual(writes);
    expect(oldPage.controls.clear()).toBe(false);
    expect(storage.writes).toEqual(writes);
    const next = pageInstance(storage);
    expect(next.state.mutationLocks).toEqual(current.state.mutationLocks);
    await next.controls.remove();
    expect(next.calls.write).toBe(0);
  });

  test("live manual readback can still clear matching authority", async () => {
    const storage = memoryStorage();
    const page = pageInstance(storage);
    expect(page.controls.stage()).toBe(true);
    await page.controls.reconcile();
    expect(page.calls).toEqual({ write: 0, read: 1, confirm: 0 });
    expect(page.state.mutationLocks).toEqual({});
    expect(page.state.customUiStatus).toEqual(removed);
    expect(page.state.notice).toBe("customUi.authoritativeReadBackConfirmed");
    expect(storage.writes).toHaveLength(2);
  });
});
