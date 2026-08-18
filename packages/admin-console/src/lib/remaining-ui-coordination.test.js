// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { AdminApiError } from "./admin-api.js";
import {
  createKeyedSingleFlightTracker,
  createLatestRequestTracker,
  mutationOutcomeUnknown,
} from "./resource-page.js";

function deferredRequest() {
  let resolveRequest;
  let rejectRequest;
  const promise = new Promise((resolve, reject) => {
    resolveRequest = resolve;
    rejectRequest = reject;
  });
  return { promise, resolve: resolveRequest, reject: rejectRequest };
}

function functionBody(source, functionName) {
  const signatureOffset = source.indexOf(`function ${functionName}(`);
  if (signatureOffset < 0) throw new Error(`Missing ${functionName}`);
  const bodyStart = source.indexOf("{", signatureOffset);
  let braceDepth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") braceDepth += 1;
    if (source[index] === "}") braceDepth -= 1;
    if (braceDepth === 0) return source.slice(bodyStart + 1, index);
  }
  throw new Error(`Unclosed ${functionName}`);
}

describe("remaining admin UI request coordination", () => {
  test("accepts only one operation per resource key", () => {
    const tracker = createKeyedSingleFlightTracker();
    const firstRotation = tracker.begin("app-one");

    expect(firstRotation).not.toBeNull();
    expect(tracker.begin("app-one")).toBeNull();
    expect(tracker.isPending("app-one")).toBe(true);
    expect(tracker.isCurrent(firstRotation)).toBe(true);
    expect(tracker.finish(firstRotation)).toBe(true);
    expect(tracker.isPending("app-one")).toBe(false);
    const nextRotation = tracker.begin("app-one");
    expect(nextRotation.generation).toBeGreaterThan(firstRotation.generation);
  });

  test("classifies interrupted mutations as outcome unknown", () => {
    expect(
      mutationOutcomeUnknown(
        new AdminApiError("timed out", 0, "request_timeout"),
      ),
    ).toBe(true);
    expect(
      mutationOutcomeUnknown(
        new AdminApiError("cancelled", 0, "request_aborted"),
      ),
    ).toBe(true);
    expect(
      mutationOutcomeUnknown(new AdminApiError("conflict", 409, "conflict")),
    ).toBe(false);
    expect(
      mutationOutcomeUnknown(new AdminApiError("audit failed", 503, "upstream")),
    ).toBe(true);
    expect(mutationOutcomeUnknown(new TypeError("network connection lost"))).toBe(
      true,
    );
  });

  test("keeps page two authoritative when page one resolves last", async () => {
    const tracker = createLatestRequestTracker();
    const pageOne = tracker.begin("users", { page: 1, search: "" });
    const slowPageOne = deferredRequest();
    const state = { rows: [], total: 0, loading: true, error: null };
    const pageOneLoad = slowPageOne.promise
      .then((response) => {
        if (!tracker.isCurrent(pageOne)) return;
        state.rows = response.items;
        state.total = response.total;
      })
      .finally(() => {
        if (tracker.isCurrent(pageOne)) state.loading = false;
      });

    const pageTwo = tracker.begin("users", { page: 2, search: "" });
    state.rows = ["page-two"];
    state.total = 100;
    state.loading = false;
    slowPageOne.resolve({ items: ["page-one"], total: 50 });
    await pageOneLoad;

    expect(tracker.isCurrent(pageTwo)).toBe(true);
    expect(state).toEqual({
      rows: ["page-two"],
      total: 100,
      loading: false,
      error: null,
    });
  });

  test("ignores an old search error and its finally block", async () => {
    const tracker = createLatestRequestTracker();
    const oldSearch = tracker.begin("users", { page: 1, search: "old" });
    const slowSearch = deferredRequest();
    const state = { rows: ["new"], total: 1, loading: false, error: null };
    const oldLoad = slowSearch.promise
      .catch((requestError) => {
        if (tracker.isCurrent(oldSearch)) state.error = requestError;
      })
      .finally(() => {
        if (tracker.isCurrent(oldSearch)) state.loading = false;
      });

    const currentSearch = tracker.begin("users", { page: 1, search: "new" });
    slowSearch.reject(new Error("old search failed"));
    await oldLoad;

    expect(tracker.isCurrent(currentSearch)).toBe(true);
    expect(state).toEqual({
      rows: ["new"],
      total: 1,
      loading: false,
      error: null,
    });
  });

  test("invalidates a deleted webhook diagnostic request", () => {
    const tracker = createLatestRequestTracker();
    const staleRequest = tracker.begin("webhook-one");
    const diagnostics = { "webhook-one": { loaded: false } };

    expect(tracker.invalidate("webhook-one")).toBe(true);
    delete diagnostics["webhook-one"];
    if (tracker.isCurrent(staleRequest)) {
      diagnostics["webhook-one"] = { loaded: true };
    }
    expect(tracker.isCurrent(staleRequest)).toBe(false);
    expect(diagnostics).toEqual({});
  });

  test("wires application rotation to confirmation, single-flight, and unknown lockout", async () => {
    const pageSource = await Bun.file(
      new URL("../routes/applications/+page.svelte", import.meta.url),
    ).text();
    const rotationBody = functionBody(pageSource, "handleRotateSecret");

    expect(rotationBody.indexOf("confirm(")).toBeLessThan(
      rotationBody.indexOf("secretRotationTracker.begin(appId)"),
    );
    expect(
      rotationBody.indexOf("secretRotationTracker.begin(appId)"),
    ).toBeLessThan(rotationBody.indexOf("rotateApplicationSecret(appId)"));
    expect(rotationBody).toContain("secretRotationTracker.isCurrent(operation)");
    expect(rotationBody).toContain("mutationOutcomeUnknown(requestError)");
    expect(pageSource).toContain("outcomeUnknown}");
    expect(pageSource).toContain("Do not rotate again");
  });

  test("guards connector factory creation with single-flight and current-list read-back", async () => {
    const pageSource = await Bun.file(
      new URL("../routes/connectors/+page.svelte", import.meta.url),
    ).text();
    const creationBody = functionBody(pageSource, "saveFactoryConnector");

    expect(creationBody).toContain('factoryCreateOperations.begin("create")');
    expect(creationBody).toContain("stageFactoryCreateLock()");
    expect(creationBody.match(/readConnectorList\(\)/g)).toHaveLength(2);
    expect(creationBody).toContain("mutationOutcomeUnknown(requestError)");
    expect(creationBody).toContain('requestError?.code === "connector_runtime_unavailable"');
    expect(creationBody).toContain("reconciledFactoryConnector({");
    expect(pageSource).toContain("factoryCreateOutcomeUnknown}");
    expect(pageSource).toContain("creatingFactory || !mutationStorageReady");
  });

  test("guards connector toggles with keyed single-flight and durable reconciliation", async () => {
    const pageSource = await Bun.file(
      new URL("../routes/connectors/+page.svelte", import.meta.url),
    ).text();
    const toggleBody = functionBody(pageSource, "handleToggle");
    const submitBody = functionBody(pageSource, "submitConnectorToggle");
    const failureBody = functionBody(pageSource, "reportConnectorToggleFailure");
    const reloadBody = functionBody(pageSource, "reconcilePersistedToggleLocks");

    expect(toggleBody).toContain("connectorToggleOperations.begin(connector.id)");
    expect(toggleBody.indexOf("connectorConfigurationRequired(connector)")).toBeLessThan(
      toggleBody.indexOf("connectorToggleOperations.begin(connector.id)"),
    );
    expect(toggleBody).toContain("stageConnectorToggleLock(connector.id)");
    expect(toggleBody).toContain("submitConnectorToggle(connector.id, expectedEnabled)");
    expect(toggleBody).toContain("reconcileSubmittedToggle(connector.id, expectedEnabled, operation)");
    expect(toggleBody).toContain("connectorToggleOperations.finish(operation)");
    expect(toggleBody).toContain("reportConnectorToggleFailure(connector.id, submitted, requestError)");
    expect(failureBody).toContain("submitted || mutationOutcomeUnknown(requestError)");
    expect(submitBody).toContain('requestError?.code === "connector_update_outcome_unknown"');
    expect(reloadBody).toContain("getConnector(lock.targetId)");
    expect(reloadBody).toContain("listed.enabled === state.enabled");
    expect(reloadBody).toContain('listed.runtime_kind !== "builtin_oauth"');
    expect(reloadBody).toContain("listed.provider_enabled === state.provider_enabled");
    expect(reloadBody).not.toContain("state?.enabled === state?.provider_enabled");
    expect(pageSource).toContain('allowedActions: ["create", "toggle"]');
    expect(pageSource).toContain("connectorToggleLocked(connector.id)");
    expect(pageSource).toContain('t("connector.configurationRequired")');
  });

  test("wires users rows, totals, errors, and loading to the current generation", async () => {
    const pageSource = await Bun.file(
      new URL("../routes/users/+page.svelte", import.meta.url),
    ).text();
    const loadBody = functionBody(pageSource, "load");

    expect(loadBody).toContain('userListRequests.begin("users"');
    expect(loadBody).toContain("listUsers(request.ownerContext)");
    expect(loadBody.match(/userListRequests\.isCurrent\(request\)/g)).toHaveLength(
      3,
    );
    expect(loadBody).toContain("finally");
  });

  test("keeps webhook logs lazy and coordinates diagnostic actions per row", async () => {
    const pageSource = await Bun.file(
      new URL("../routes/webhooks/+page.svelte", import.meta.url),
    ).text();
    const loadBody = functionBody(pageSource, "load");
    const diagnosticBody = functionBody(pageSource, "fetchWebhookDiagnostics");

    expect(loadBody).toContain("listWebhooks()");
    expect(loadBody).toContain("listWebhookEvents()");
    expect(loadBody).not.toContain("listWebhookLogs(");
    expect(loadBody).not.toContain("loadWebhookDiagnostics(");
    expect(diagnosticBody).toContain("diagnosticRequestIsCurrent(");
    expect(pageSource).toContain("diagnosticRequests.invalidate(id)");
    expect(pageSource).toContain("loadWebhookDiagnostics(whId, operation)");
    expect(pageSource.match(/disabled=\{webhookPending\(wh\.id\)\}/g).length).toBeGreaterThanOrEqual(
      5,
    );
  });
});
