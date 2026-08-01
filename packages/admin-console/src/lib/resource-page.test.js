// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { AdminApiError } from "./admin-api.js";
import {
  applicationDetailTabValues,
  capabilityAvailable,
  collectionItems,
  createOperationTracker,
  isLatestResourceLoad,
  resourceOwnedItems,
  requestErrorState,
  tabFromRoute,
} from "./resource-page.js";

function deferredRequest() {
  let resolve;
  const promise = new Promise((resolveRequest) => {
    resolve = resolveRequest;
  });
  return { promise, resolve };
}

const ROLE_MUTATION_HANDLERS = [
  "handleCreate",
  "handleCreateTemplate",
  "handleUpdateRole",
  "handleDelete",
  "handleCloneRole",
  "toggleCatalogPermission",
  "applyGroup",
  "handleAddCustomPermission",
  "handleDeletePermission",
  "handleAssignRole",
  "revokeAssignmentById",
];

const APPLICATION_MUTATION_HANDLERS = [
  "runMutation",
  "rotateSecret",
  "removeApplication",
];

const ROLE_MUTATION_BUTTON_ACTIONS = [
  ...ROLE_MUTATION_HANDLERS,
  "handleRevokeAssignment",
  "startClone",
  "startEdit",
  "selectRole",
  "showCreate = !showCreate",
  "editingRoleId = null",
  "showClone = false",
];

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

function sourceButtonBlocks(source) {
  return [...source.matchAll(/<button\b[\s\S]*?<\/button\s*>/g)].map(
    (match) => match[0],
  );
}

class ResourcePageHarness {
  #currentContext = null;
  #generation = 0;
  state = { revealedSecret: "", selectedDelivery: null };

  navigate(resourceId, tab) {
    this.#currentContext = {
      generation: (this.#generation += 1),
      resourceId,
      tab,
    };
    this.state.revealedSecret = "";
    this.state.selectedDelivery = null;
    return this.#currentContext;
  }

  commit(loadContext, update) {
    if (!isLatestResourceLoad(loadContext, this.#currentContext)) return false;
    Object.assign(this.state, update);
    return true;
  }
}

describe("resource page helpers", () => {
  test("normalizes supported management list envelopes", () => {
    expect(collectionItems({ items: [{ id: "one" }] })).toEqual([
      { id: "one" },
    ]);
    expect(collectionItems({ data: { items: [{ id: "two" }] } })).toEqual([
      { id: "two" },
    ]);
    expect(collectionItems([])).toEqual([]);
    expect(() => collectionItems({ status: "ok" })).toThrow(
      "unknown collection envelope",
    );
    expect(() => collectionItems(null)).toThrow("invalid collection payload");
  });

  test("preserves capability and authorization boundaries", () => {
    expect(
      requestErrorState(
        new AdminApiError("Forbidden", 403, "insufficient_permissions"),
      ),
    ).toBe("forbidden");
    expect(
      requestErrorState(new AdminApiError("Missing", 404, "not_found")),
    ).toBe("not_found");
    expect(
      requestErrorState(
        new AdminApiError("Unavailable", 501, "capability_unavailable"),
      ),
    ).toBe("unavailable");
    expect(
      requestErrorState(
        new AdminApiError("Unsupported", 400, "not_supported"),
      ),
    ).toBe("unsupported");
    expect(requestErrorState(new AdminApiError("Missing capability", 501))).toBe(
      "unavailable",
    );
    expect(requestErrorState(new AdminApiError("Down", 503))).toBe(
      "unavailable",
    );
  });

  test("accepts only known tab values from a deep link", () => {
    const allowed = ["settings", "logs"];
    expect(tabFromRoute("logs", allowed, "settings")).toBe("logs");
    expect(tabFromRoute("pat", allowed, "settings")).toBe("settings");
  });

  test("rejects stale resource loads by generation, resource, or tab", () => {
    const currentLoad = {
      generation: 2,
      resourceId: "resource-b",
      tab: "settings",
    };

    expect(isLatestResourceLoad({ ...currentLoad }, currentLoad)).toBe(true);
    expect(
      isLatestResourceLoad(
        { ...currentLoad, generation: 1 },
        currentLoad,
      ),
    ).toBe(false);
    expect(
      isLatestResourceLoad(
        { ...currentLoad, resourceId: "resource-a" },
        currentLoad,
      ),
    ).toBe(false);
    expect(
      isLatestResourceLoad({ ...currentLoad, tab: "logs" }, currentLoad),
    ).toBe(false);
  });

  test("keeps current saving state when an A to B to A mutation finishes late", async () => {
    let saving = false;
    const tracker = createOperationTracker((pending) => {
      saving = pending;
    });
    const slowRequest = deferredRequest();
    const staleOperation = tracker.begin({
      generation: 1,
      resourceId: "resource-a",
      tab: "settings",
    });
    const staleCompletion = slowRequest.promise.then(() =>
      tracker.finish(staleOperation),
    );

    tracker.invalidate();
    const currentOperation = tracker.begin({
      generation: 3,
      resourceId: "resource-a",
      tab: "settings",
    });
    slowRequest.resolve();

    expect(await staleCompletion).toBe(false);
    expect(tracker.isCurrent(currentOperation)).toBe(true);
    expect(saving).toBe(true);
    expect(tracker.finish(currentOperation)).toBe(true);
    expect(saving).toBe(false);
  });

  test("keeps a new operation pending when any old role mutation finishes", async () => {
    for (const mutationName of ROLE_MUTATION_HANDLERS) {
      let saving = false;
      const tracker = createOperationTracker((pending) => {
        saving = pending;
      });
      const staleRequest = deferredRequest();
      const staleOperation = tracker.begin({ mutationName });
      const staleCompletion = staleRequest.promise.then(() =>
        tracker.finish(staleOperation),
      );
      const currentOperation = tracker.begin({ mutationName: "current" });

      staleRequest.resolve();
      expect(await staleCompletion).toBe(false);
      expect(tracker.isCurrent(currentOperation)).toBe(true);
      expect(saving).toBe(true);
      expect(tracker.finish(currentOperation)).toBe(true);
      expect(saving).toBe(false);
    }
  });

  test("keeps save or rotate pending when a stale application delete finishes", async () => {
    for (const currentMutation of ["save", "rotate"]) {
      let saving = false;
      const tracker = createOperationTracker((pending) => {
        saving = pending;
      });
      const deleteRequest = deferredRequest();
      const deleteOperation = tracker.begin({ mutationName: "delete" });
      const deleteCompletion = deleteRequest.promise.then(() =>
        tracker.finish(deleteOperation),
      );

      tracker.invalidate();
      const currentOperation = tracker.begin({ mutationName: currentMutation });
      deleteRequest.resolve();

      expect(await deleteCompletion).toBe(false);
      expect(tracker.isCurrent(currentOperation)).toBe(true);
      expect(saving).toBe(true);
      expect(tracker.finish(currentOperation)).toBe(true);
      expect(saving).toBe(false);
    }
  });

  test("wires application save, rotate, and delete through one tracker", async () => {
    const applicationPageUrl = new URL(
      "../routes/applications/[appId]/+page.svelte",
      import.meta.url,
    );
    const applicationPageSource = await Bun.file(applicationPageUrl).text();

    for (const handlerName of APPLICATION_MUTATION_HANDLERS) {
      const handlerBody = functionBody(applicationPageSource, handlerName);
      expect(handlerBody).toContain("if (saving)");
      expect(handlerBody).toContain("mutationTracker.begin(");
      expect(handlerBody).toContain("isCurrentMutation(operation)");
      expect(handlerBody).toContain("mutationTracker.finish(operation)");
    }
    const applicationButtons = sourceButtonBlocks(applicationPageSource);
    for (const actionName of [
      "saveApplication",
      "rotateSecret",
      "removeApplication",
    ]) {
      const actionButton = applicationButtons.find((button) =>
        button.includes(`onclick={${actionName}}`),
      );
      expect(actionButton).toMatch(/disabled=\{[\s\S]*?\bsaving\b[\s\S]*?\}/);
    }
  });

  test("wires every roles mutation handler through the operation tracker", async () => {
    const rolesPageUrl = new URL(
      "../routes/roles/+page.svelte",
      import.meta.url,
    );
    const rolesPageSource = await Bun.file(rolesPageUrl).text();
    const declaredHandlers = [
      ...rolesPageSource.matchAll(
        /async function (handle\w+|toggleCatalogPermission|applyGroup|revokeAssignmentById)\s*\(/g,
      ),
    ].map((match) => match[1]);

    expect(declaredHandlers.sort()).toEqual([...ROLE_MUTATION_HANDLERS].sort());
    for (const handlerName of ROLE_MUTATION_HANDLERS) {
      const handlerBody = functionBody(rolesPageSource, handlerName);
      expect(handlerBody).toContain("mutationTracker.begin(");
      expect(handlerBody).toContain("mutationTracker.finish(operation)");
      expect(handlerBody).toContain("saving");
    }
  });

  test("disables every conflicting roles action while a mutation is pending", async () => {
    const rolesPageUrl = new URL(
      "../routes/roles/+page.svelte",
      import.meta.url,
    );
    const rolesPageSource = await Bun.file(rolesPageUrl).text();
    const buttonBlocks = sourceButtonBlocks(rolesPageSource);

    for (const actionName of ROLE_MUTATION_BUTTON_ACTIONS) {
      const actionButtons = buttonBlocks.filter((button) => {
        if (actionName.includes(" = ")) return button.includes(actionName);
        return (
          button.includes(`${actionName}(`) ||
          button.includes(`onclick={${actionName}}`)
        );
      });
      expect(actionButtons.length).toBeGreaterThan(0);
      for (const button of actionButtons) {
        expect(button).toMatch(/disabled=\{[\s\S]*?\bsaving\b[\s\S]*?\}/);
      }
    }
  });

  test("freezes every roles mutation form revision while saving", async () => {
    const rolesPageUrl = new URL(
      "../routes/roles/+page.svelte",
      import.meta.url,
    );
    const rolesPageSource = await Bun.file(rolesPageUrl).text();
    const savingFieldsets = [
      ...rolesPageSource.matchAll(
        /<fieldset\b[^>]*disabled=\{saving\}[^>]*>[\s\S]*?<\/fieldset>/g,
      ),
    ].map((match) => match[0]);
    const protectedMarkup = savingFieldsets.join("\n");
    const readOnlyFilterStates = new Set([
      "search",
      "selectedGroup",
      "permissionQuery",
    ]);
    const bindingEntries = [
      ...rolesPageSource.matchAll(
        /bind:(?:value|checked|group)=\{([A-Za-z]\w*)(?:\.[^}]*)?\}/g,
      ),
    ].map((match) => ({ markup: match[0], stateName: match[1] }));
    const unprotectedBindings = bindingEntries.filter(
      ({ markup, stateName }) =>
        !readOnlyFilterStates.has(stateName) &&
        !protectedMarkup.includes(markup),
    );

    expect(savingFieldsets.length).toBeGreaterThan(0);
    expect(unprotectedBindings).toEqual([]);

    for (const actionName of [
      "chooseTarget",
      "clearOrganization",
      "chooseOrganization",
    ]) {
      expect(protectedMarkup).toContain(actionName);
    }
    for (const functionName of [
      "chooseTarget",
      "clearOrganization",
      "chooseOrganization",
    ]) {
      expect(functionBody(rolesPageSource, functionName)).toContain(
        "if (saving) return",
      );
    }
  });

  test("binds a mutation to its loaded owner instead of the current route", () => {
    const tracker = createOperationTracker(() => {});
    const loadedContext = {
      generation: 4,
      resourceId: "loaded-owner",
      tab: "members",
    };
    const operation = tracker.begin(loadedContext);

    expect(operation.ownerContext.resourceId).toBe("loaded-owner");
    expect(operation.ownerContext.tab).toBe("members");
  });

  test("finishes the active mutation after its refresh advances load generation", () => {
    let saving = false;
    const tracker = createOperationTracker((pending) => {
      saving = pending;
    });
    const operation = tracker.begin({
      generation: 1,
      resourceId: "resource-a",
      tab: "settings",
    });
    const refreshedLoad = {
      generation: 2,
      resourceId: "resource-a",
      tab: "settings",
    };

    expect(isLatestResourceLoad(operation.ownerContext, refreshedLoad)).toBe(
      false,
    );
    expect(tracker.finish(operation)).toBe(true);
    expect(saving).toBe(false);
  });

  test("clears secrets and deliveries and rejects their stale responses", () => {
    const pageHarness = new ResourcePageHarness();
    const firstLoad = pageHarness.navigate("resource-a", "requests");
    pageHarness.commit(firstLoad, {
      revealedSecret: "secret-a",
      selectedDelivery: { id: "delivery-a" },
    });

    pageHarness.navigate("resource-b", "settings");
    const currentLoad = pageHarness.navigate("resource-a", "requests");

    expect(pageHarness.state).toEqual({
      revealedSecret: "",
      selectedDelivery: null,
    });
    expect(
      pageHarness.commit(firstLoad, {
        revealedSecret: "stale-secret",
        selectedDelivery: { id: "stale-delivery" },
      }),
    ).toBe(false);
    expect(pageHarness.commit(currentLoad, { revealedSecret: "fresh" })).toBe(
      true,
    );
    expect(pageHarness.state.revealedSecret).toBe("fresh");
    expect(pageHarness.state.selectedDelivery).toBeNull();
  });

  test("rejects late role and target payloads after a newer page load", async () => {
    const pageHarness = new ResourcePageHarness();
    const slowRoles = deferredRequest();
    const slowTargets = deferredRequest();
    const staleLoad = pageHarness.navigate("roles", "list");
    const staleCompletion = Promise.all([
      slowRoles.promise,
      slowTargets.promise,
    ]).then(([roles, users]) =>
      pageHarness.commit(staleLoad, { roles, users, loading: false }),
    );

    const currentLoad = pageHarness.navigate("roles", "list");
    pageHarness.commit(currentLoad, {
      roles: [{ id: "current-role" }],
      users: [{ id: "current-user" }],
      loading: false,
    });
    slowRoles.resolve([{ id: "stale-role" }]);
    slowTargets.resolve([{ id: "stale-user" }]);

    expect(await staleCompletion).toBe(false);
    expect(pageHarness.state.roles).toEqual([{ id: "current-role" }]);
    expect(pageHarness.state.users).toEqual([{ id: "current-user" }]);
  });

  test("hides assignments owned by a different selected role", () => {
    const assignments = [{ id: "assignment-a" }];

    expect(resourceOwnedItems(assignments, "role-a", "role-b")).toEqual([]);
    expect(resourceOwnedItems(assignments, "role-a", "role-a")).toBe(
      assignments,
    );
  });

  test("requires an explicit capability availability signal", () => {
    expect(
      capabilityAvailable(
        { capabilities: { tenant_collaborators_v1: { available: true } } },
        "tenant_collaborators_v1",
      ),
    ).toBe(true);
    expect(
      capabilityAvailable({ capabilities: [] }, "tenant_collaborators_v1"),
    ).toBe(false);
  });

  test("derives application tabs from type and explicit backend capabilities", () => {
    expect(
      applicationDetailTabValues({
        type: "m2m",
        grant_types: ["client_credentials"],
      }),
    ).toEqual(["settings", "roles", "logs", "permissions", "organizations"]);
    expect(
      applicationDetailTabValues({
        type: "web",
        capabilities: {
          branding: { available: false },
          rules: { available: false },
          roles: { available: true },
        },
      }),
    ).toEqual(["settings", "roles", "logs", "permissions", "organizations"]);
  });
});
