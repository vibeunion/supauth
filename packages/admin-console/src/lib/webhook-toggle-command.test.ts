import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import ts from "typescript";
import type { AdminEndpointResult } from "@supauth/shared";
import { extractSvelteSafetyRegions } from "../../scripts/static-safety-svelte.js";
import { AdminApiError } from "./admin-api.js";
import { completeCollectionItems, createKeyedSingleFlightTracker } from "./resource-page.js";
import { toggleWebhookCommand } from "./webhook-toggle-command.js";

const webhook = {
  id: "webhook-a", url: "https://example.test/hook", events: [], enabled: false,
  secret_configured: true, created_at: "2026-09-09", updated_at: "2026-09-09",
} satisfies AdminEndpointResult<"updateWebhook">;
const enabledWebhook = { ...webhook, enabled: true };
const complete = { items: [enabledWebhook], total: 1 };
const input = { params: { webhookId: webhook.id }, body: { enabled: true } };

function probe(
  write: () => Promise<unknown> = async () => enabledWebhook,
  read: () => Promise<unknown> = async () => complete,
) {
  const calls = { write: 0, read: 0 };
  const received: unknown[] = [];
  const transport: Parameters<typeof toggleWebhookCommand>[1] = {
    write(target) {
      calls.write++;
      received.push(target);
      return write();
    },
    read() {
      calls.read++;
      return read();
    },
  };
  return { calls, received, transport };
}

describe("webhook toggle authoritative command", () => {
  test("transforms shared input and authority without losing validation proof", async () => {
    const setup = probe();
    const result = await toggleWebhookCommand(input, setup.transport);
    expect(result.kind).toBe("confirmed");
    if (result.kind !== "confirmed") throw new Error("Expected confirmed");
    expect(result.authority).toEqual([enabledWebhook]);
    expect(result.acknowledgement).toEqual(enabledWebhook);
    expect(setup.received).toEqual([{ id: webhook.id, expectedEnabled: true }]);
    expect(setup.calls).toEqual({ write: 1, read: 1 });
  });

  test("acknowledgement alone does not finish a delayed read", async () => {
    const read = Promise.withResolvers<unknown>();
    const started = Promise.withResolvers<void>();
    const setup = probe(undefined, () => {
      started.resolve();
      return read.promise;
    });
    let finished = false;
    const command = toggleWebhookCommand(input, setup.transport).then((result) => {
      finished = true;
      return result;
    });
    await started.promise;
    expect(finished).toBe(false);
    read.resolve(complete);
    expect((await command).kind).toBe("confirmed");
    expect(setup.calls).toEqual({ write: 1, read: 1 });
  });

  test.each([
    new AdminApiError("Audit unauthorized after update", 401),
    new AdminApiError("Audit forbidden after update", 403),
    new AdminApiError("Conflict after update", 409),
    new AdminApiError("Internal failure", 500),
    new AdminApiError("Timeout", 0, "request_timeout"),
    new AdminApiError("Aborted", 0, "request_aborted"),
    new TypeError("Network failure"),
    new Error("Unknown failure"),
  ])("all write errors read back without denial or replay: %s", async (writeError) => {
    let effect = false;
    const setup = probe(async () => {
      effect = true;
      throw writeError;
    }, async () => {
      expect(effect).toBe(true);
      return complete;
    });
    const result = await toggleWebhookCommand(input, setup.transport);
    expect(result.kind).toBe("confirmed");
    if (result.kind !== "confirmed") throw new Error("Expected confirmed");
    expect(result.writeError).toBe(writeError);
    expect(result.acknowledgement).toBeNull();
    expect(setup.calls).toEqual({ write: 1, read: 1 });
  });

  test.each([401, 403, 409])("write %s with nonmatching authority remains unknown", async (status) => {
    const setup = probe(async () => { throw new AdminApiError("After effect", status); },
      async () => ({ items: [webhook], total: 1 }));
    expect((await toggleWebhookCommand(input, setup.transport)).kind).toBe("unknown");
    expect(setup.calls).toEqual({ write: 1, read: 1 });
  });

  test.each([
    new AdminApiError("Read forbidden", 403),
    new AdminApiError("Read failed", 500),
    new Error("Unknown read error"),
  ])("rejected reads are cached even when lookup follows send: %s", async (readError) => {
    const setup = probe(undefined, async () => { throw readError; });
    const result = await toggleWebhookCommand(input, setup.transport);
    expect(result.kind).toBe("unknown");
    if (result.kind !== "unknown") throw new Error("Expected unknown");
    expect(result.readError).toBe(readError);
    expect(result.writeError).toBeNull();
    expect(setup.calls).toEqual({ write: 1, read: 1 });
  });

  test("synchronously throwing reads are cached too", async () => {
    const setup = probe(undefined, () => { throw new Error("Sync read"); });
    expect((await toggleWebhookCommand(input, setup.transport)).kind).toBe("unknown");
    expect(setup.calls).toEqual({ write: 1, read: 1 });
  });

  test.each([
    null, {}, { ...input, params: { webhookId: "" } },
    { ...input, params: { webhookId: " " } },
    { ...input, body: {} }, { ...input, body: { enabled: "true" } },
  ])("malformed input sends zero requests: %j", async (value) => {
    const setup = probe();
    expect((await toggleWebhookCommand(value, setup.transport)).kind).toBe("invalid");
    expect(setup.calls).toEqual({ write: 0, read: 0 });
  });

  test.each([
    null, [], {},
    { items: [enabledWebhook], total: 2 },
    { items: [enabledWebhook], total: 1, page: 2, limit: 1 },
    { items: [enabledWebhook, { ...webhook, id: "webhook-b" }], total: 2, page: 1, limit: 1 },
    { items: [], total: 0 },
    { items: [{ ...enabledWebhook, id: "" }], total: 1 },
    { items: [{ ...enabledWebhook, id: " " }], total: 1 },
    { items: [{ ...enabledWebhook, id: "webhook-b" }], total: 1 },
    { items: [{ ...enabledWebhook, enabled: "true" }], total: 1 },
    { items: [enabledWebhook, enabledWebhook], total: 2 },
    { items: [enabledWebhook, webhook], total: 2 },
    { items: [enabledWebhook, { ...webhook, id: "b" }, { ...enabledWebhook, id: "b" }], total: 3 },
  ])("malformed, partial, duplicate or unrelated authority never confirms: %j", async (authority) => {
    const setup = probe(undefined, async () => authority);
    expect((await toggleWebhookCommand(input, setup.transport)).kind).toBe("unknown");
    expect(setup.calls).toEqual({ write: 1, read: 1 });
  });

  test.each([true, false])("malformed ack still needs matching authority: %s", async (matches) => {
    const setup = probe(async () => ({ id: webhook.id }), async () =>
      matches ? complete : { items: [webhook], total: 1 });
    const result = await toggleWebhookCommand(input, setup.transport);
    expect(result.kind).toBe(matches ? "confirmed" : "unknown");
    if (result.kind !== "confirmed" && result.kind !== "unknown") throw new Error("Expected readback");
    expect(result.writeError).toBeInstanceOf(Error);
    expect(result.acknowledgement).toBeNull();
    expect(setup.calls).toEqual({ write: 1, read: 1 });
  });

  test("captures original id and enabled primitives before awaiting transport", async () => {
    const write = Promise.withResolvers<unknown>();
    const value = { params: { webhookId: webhook.id }, body: { enabled: true } };
    const setup = probe(() => write.promise, async () => ({
      items: [{ ...webhook, id: "webhook-b" }], total: 1,
    }));
    const command = toggleWebhookCommand(value, setup.transport);
    value.params.webhookId = "webhook-b";
    value.body.enabled = false;
    write.resolve(enabledWebhook);
    expect((await command).kind).toBe("unknown");
    expect(setup.received).toEqual([{ id: webhook.id, expectedEnabled: true }]);
    expect(setup.calls).toEqual({ write: 1, read: 1 });
  });
});

const pageSource = readFileSync(
  new URL("../routes/webhooks/+page.svelte", import.meta.url), "utf8",
);
const instance = extractSvelteSafetyRegions(pageSource, "webhooks/+page.svelte")
  .scripts.find((script) => script.kind === "instance");
if (!instance) throw new Error("Missing webhook page script");
const pageScript = ts.createSourceFile("webhooks.ts", instance.text, ts.ScriptTarget.Latest, true);
const pageFunctions = [
  "handleToggle", "webhookIdentity", "completeWebhookList", "readWebhookList", "applyWebhookList",
  "beginWebhookOperation", "finishWebhookOperation",
];
const extracted = pageFunctions.map((name) => {
  const declaration = pageScript.statements.find(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  if (!declaration) throw new Error(`Missing page function ${name}`);
  return declaration.getText(pageScript);
}).join("\n");
const mountStatement = pageScript.statements.find((statement) =>
  ts.isExpressionStatement(statement)
  && ts.isCallExpression(statement.expression)
  && ts.isIdentifier(statement.expression.expression)
  && statement.expression.expression.text === "onMount",
);
if (!mountStatement) throw new Error("Missing page lifecycle");
const executable = ts.transpileModule(`${extracted}\n${mountStatement.getText(pageScript)}`, {
  compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
}).outputText;

function pageToggle(scenario: {
  write?: () => Promise<unknown>;
  read?: () => Promise<unknown>;
  clearSucceeds?: boolean;
  stageSucceeds?: boolean;
  locked?: boolean;
  storageReady?: boolean;
  doubleClick?: boolean;
  durableState?: { locked: boolean; revision: number };
} = {}) {
  const durable = scenario.durableState ?? { locked: scenario.locked ?? false, revision: 0 };
  const state = {
    write: 0, read: 0, apply: 0, clear: 0, pending: false,
    locked: durable.locked, storageReady: scenario.storageReady ?? true,
    operationCurrent: true, listCurrent: true,
  };
  const done = Promise.withResolvers<void>();
  const messages: { error: string | null } = { error: null };
  const writeArguments: unknown[][] = [];
  const readArguments: unknown[][] = [];
  const operations = createKeyedSingleFlightTracker<string, { action: string; webhookId: string }>();
  let dispose: () => void = () => { throw new Error("Page has not mounted"); };
  const context = {
    pageDisposed: false,
    onMount: (mount: () => void | (() => void)) => {
      const cleanup = mount();
      if (typeof cleanup !== "function") throw new Error("Missing page cleanup");
      dispose = cleanup;
    },
    restoreWebhookMutationLocks: () => { state.locked = durable.locked; },
    load: async () => {},
    webhook: { ...webhook },
    webhooks: [webhook],
    get error() { return messages.error; },
    set error(value: unknown) {
      if (value !== null && typeof value !== "string") throw new Error("Invalid page error");
      messages.error = value;
    },
    get mutationStorageReady() { return state.storageReady; },
    t: (value: string) => value,
    errorMessage: (value: unknown) => value instanceof Error ? value.message : "Unknown error",
    toggleWebhookCommand: (value: unknown, transport: Parameters<typeof toggleWebhookCommand>[1]) =>
      toggleWebhookCommand(structuredClone(value), transport),
    completeCollectionItems,
    webhookPending: () => state.pending,
    webhookMutationLocked: () => state.locked,
    diagnostics: { [webhook.id]: { pending: false } },
    updateDiagnostic: (_id: string, update: { pending?: boolean }) => {
      if (update.pending !== undefined) state.pending = update.pending;
    },
    stageWebhookMutation: () => {
      if (scenario.stageSucceeds === false) return false;
      state.locked = true;
      durable.locked = true;
      durable.revision++;
      return true;
    },
    clearWebhookMutationLock: () => {
      state.clear++;
      if (scenario.clearSucceeds === false) {
        state.storageReady = false;
        return false;
      }
      state.locked = false;
      durable.locked = false;
      durable.revision++;
      return true;
    },
    recordWebhookMutationUnknown: () => { state.locked = true; },
    webhookOperations: {
      begin: operations.begin.bind(operations),
      finish: operations.finish.bind(operations),
      isCurrent: (operation: Parameters<typeof operations.isCurrent>[0]) =>
        state.operationCurrent && operations.isCurrent(operation),
    },
    webhookListRequests: { begin: () => ({}), isCurrent: () => state.listCurrent },
    reconcileDiagnosticState: () => { state.apply++; },
    updateWebhook: (id: unknown, body: unknown, options: unknown) => {
      state.write++;
      writeArguments.push([id, body, options]);
      return scenario.write ? scenario.write() : Promise.resolve(enabledWebhook);
    },
    listWebhooks: (...args: unknown[]) => {
      state.read++;
      readArguments.push(args);
      return scenario.read ? scenario.read() : Promise.resolve(complete);
    },
    resolve: () => done.resolve(),
    reject: (error: unknown) => done.reject(error),
  };
  // 执行页面真实函数；VM 输入跨 realm 复制后仍经真实 schema 校验，不复制 toggle 控制流。
  new Script(`${executable}
    void Promise.all([
      handleToggle(webhook)${scenario.doubleClick ? ", handleToggle(webhook)" : ""}
    ]).then(resolve, reject);
  `).runInNewContext(context, { timeout: 1000 });
  return { state, messages, operations, writeArguments, readArguments, dispose: () => dispose(), completion: done.promise };
}

describe("webhook toggle actual page function wiring", () => {
  test("disables authentication replay only for the write transport", async () => {
    const run = pageToggle();
    await run.completion;
    expect(run.writeArguments).toEqual([
      [webhook.id, { enabled: true }, { authenticationRetry: "never" }],
    ]);
    expect(run.readArguments).toEqual([[]]);
    expect(run.state.write).toBe(1);
    expect(run.state.read).toBe(1);
    expect(run.state.locked).toBe(false);
  });

  test("double interaction waits for authority and performs one write", async () => {
    const authority = Promise.withResolvers<unknown>();
    const started = Promise.withResolvers<void>();
    const run = pageToggle({ doubleClick: true, read: () => {
      started.resolve();
      return authority.promise;
    } });
    await started.promise;
    expect(run.state.write).toBe(1);
    expect(run.state.locked).toBe(true);
    expect(run.state.pending).toBe(true);
    expect(run.state.clear).toBe(0);
    authority.resolve(complete);
    await run.completion;
    expect(run.state.read).toBe(1);
    expect(run.state.apply).toBe(1);
    expect(run.state.clear).toBe(1);
    expect(run.state.locked).toBe(false);
    expect(run.state.pending).toBe(false);
  });

  test.each(["operation", "list"])("stale %s cannot apply or clear", async (stale) => {
    const authority = Promise.withResolvers<unknown>();
    const run = pageToggle({ read: () => authority.promise });
    if (stale === "operation") run.state.operationCurrent = false;
    else run.state.listCurrent = false;
    authority.resolve(complete);
    await run.completion;
    expect(run.state.write).toBe(1);
    expect(run.state.read).toBe(1);
    expect(run.state.apply).toBe(0);
    expect(run.state.clear).toBe(0);
    expect(run.state.locked).toBe(true);
  });

  test("verified status with clear storage failure retains the lock and error", async () => {
    const run = pageToggle({ clearSucceeds: false });
    await run.completion;
    expect(run.state.apply).toBe(1);
    expect(run.state.locked).toBe(true);
    expect(run.state.storageReady).toBe(false);
    expect(run.messages.error).toContain("lock could not be cleared");
    expect(run.state.write).toBe(1);
  });

  test("an invalidated operation cannot finish a newer same-key operation", async () => {
    const authority = Promise.withResolvers<unknown>();
    const started = Promise.withResolvers<void>();
    const run = pageToggle({ read: () => {
      started.resolve();
      return authority.promise;
    } });
    await started.promise;
    run.operations.invalidate(webhook.id);
    const newer = run.operations.begin(webhook.id, { action: "toggle", webhookId: webhook.id });
    if (!newer) throw new Error("Expected newer operation");
    run.messages.error = "Newer operation error";
    authority.resolve(complete);
    await run.completion;
    expect(run.operations.isCurrent(newer)).toBe(true);
    expect(run.state.pending).toBe(true);
    expect(run.messages.error).toBe("Newer operation error");
    expect(run.state.apply).toBe(0);
    expect(run.state.clear).toBe(0);
    expect(run.state.locked).toBe(true);
  });

  test.each([true, false])("disposed page cannot change a remounted page's durable lock: read succeeds=%s", async (succeeds) => {
    const authority = Promise.withResolvers<unknown>();
    const started = Promise.withResolvers<void>();
    const durableState = { locked: false, revision: 0 };
    const oldPage = pageToggle({ durableState, read: () => {
      started.resolve();
      return authority.promise;
    } });
    await started.promise;
    expect(oldPage.state.write).toBe(1);
    expect(durableState.locked).toBe(true);
    oldPage.dispose();
    oldPage.messages.error = "Detached instance state";
    // 新实例恢复同一目标的当前持久锁，旧实例不得改写这一版本。
    durableState.revision++;
    const revision = durableState.revision;
    const newPage = pageToggle({ durableState });
    await newPage.completion;
    newPage.messages.error = "Current instance state";
    expect(newPage.state.locked).toBe(true);
    expect(newPage.state.write).toBe(0);
    if (succeeds) authority.resolve(complete);
    else authority.reject(new AdminApiError("Old read failed", 403));
    await oldPage.completion;
    expect(oldPage.state.apply).toBe(0);
    expect(oldPage.state.clear).toBe(0);
    expect(oldPage.state.pending).toBe(true);
    expect(oldPage.messages.error).toBe("Detached instance state");
    expect(newPage.messages.error).toBe("Current instance state");
    expect(newPage.state.locked).toBe(true);
    expect(durableState).toEqual({ locked: true, revision });
    const remounted = pageToggle({ durableState });
    await remounted.completion;
    expect(remounted.state.locked).toBe(true);
    expect(remounted.state.write).toBe(0);
  });

  test.each([
    { locked: true }, { storageReady: false }, { stageSucceeds: false },
  ])("restored locks and unavailable persistence prevent writes: %j", async (scenario) => {
    const run = pageToggle(scenario);
    await run.completion;
    expect(run.state.write).toBe(0);
    expect(run.state.read).toBe(0);
    expect(run.state.clear).toBe(0);
  });

  test.each([
    { items: [enabledWebhook], total: 2 },
    { items: [enabledWebhook, webhook], total: 2 },
  ])("page does not discard partial or duplicate evidence: %j", async (response) => {
    const run = pageToggle({ read: async () => response });
    await run.completion;
    expect(run.state.read).toBe(1);
    expect(run.state.apply).toBe(0);
    expect(run.state.clear).toBe(0);
    expect(run.state.locked).toBe(true);
    expect(run.messages.error).toContain("read-back failed");
  });

  test("write401 followed by failed read retains the durable lock", async () => {
    const run = pageToggle({
      write: async () => { throw new AdminApiError("Audit denied", 401); },
      read: async () => { throw new AdminApiError("Read denied", 403); },
    });
    await run.completion;
    expect(run.state.write).toBe(1);
    expect(run.state.read).toBe(1);
    expect(run.state.clear).toBe(0);
    expect(run.state.locked).toBe(true);
  });
});
