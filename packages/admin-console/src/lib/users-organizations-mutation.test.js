import { readFile } from 'node:fs/promises';
import { describe, expect, test } from "bun:test";
import ts from "typescript";
import { AdminApiError } from "./admin-api.js";
import { deferredRequest } from "./providers/auth-fixtures.js";
import {
  collectionPage,
  createKeyedSingleFlightTracker,
  createLatestRequestTracker,
  mutationOutcomeUnknown,
} from "./resource-page.js";

/** @param {string} source @param {string} functionName */
function functionBody(source, functionName) {
  const input = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)?.[1] || source;
  const compiled = ts.transpileModule(input, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
  });
  if (compiled.diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    throw new Error("Invalid TypeScript source");
  }
  const script = compiled.outputText;
  const file = ts.createSourceFile("page.js", script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declaration = file.statements.find((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === functionName,
  );
  expect(declaration).toBeDefined();
  if (!declaration || !ts.isFunctionDeclaration(declaration) || !declaration.body) {
    throw new Error(`Missing ${functionName}`);
  }
  return script.slice(declaration.body.getStart(file) + 1, declaration.body.end - 1);
}

/** @param {string} body @param {string} code */
function hasErrorCodeComparison(body, code) {
  const file = ts.createSourceFile("handler.js", body, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let matched = false;
  /** @param {import("typescript").Node} node */
  function visit(node) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      ts.isPropertyAccessExpression(node.left) && ts.isIdentifier(node.left.expression) &&
      node.left.expression.text === "requestError" && node.left.name.text === "code" &&
      ts.isStringLiteral(node.right) && node.right.text === code) matched = true;
    ts.forEachChild(node, visit);
  }
  visit(file);
  return matched;
}

/** @param {string} relativePath */
async function routeSource(relativePath) {
  return readFile(new URL(`../routes/${relativePath}`, import.meta.url), 'utf8');
}

const MUTATION_PENDING_CASES = [
  {
    route: "users/+page.svelte",
    resourceArgument: "ownerId",
    bindings: {
      begin: "beginUserMutation",
      finish: "finishUserMutation",
      key: "userMutationKey",
      locks: "userMutationLocks",
      pending: "userMutationPending",
      pendingForResource: "userResourcePending",
      busy: "userResourceBusy",
      tracker: "userMutationTracker",
    },
    staleContext: {
      action: "restore",
      resourceId: "user-one",
      ownerId: "user-one",
    },
    normalContext: {
      action: "suspend",
      resourceId: "user-one",
      ownerId: "user-one",
    },
  },
  {
    route: "organizations/+page.svelte",
    resourceArgument: "resourceId",
    bindings: {
      begin: "beginOrganizationMutation",
      finish: "finishOrganizationMutation",
      key: "organizationMutationKey",
      locks: "organizationMutationLocks",
      pending: "organizationMutationPending",
      pendingForResource: "organizationResourcePending",
      busy: "organizationResourceBusy",
      tracker: "organizationMutationTracker",
    },
    staleContext: { action: "delete", resourceId: "organization-one" },
    normalContext: { action: "delete", resourceId: "organization-one" },
  },
];

/**
 * @typedef {{action: string, resourceId: string, ownerId?: string}} PendingContext
 * @typedef {import("./resource-page.js").KeyedOperation<string, PendingContext>} PendingOperation
 * @typedef {ReturnType<typeof createKeyedSingleFlightTracker<string, PendingContext>>} PendingTracker
 * @typedef {Record<string, PendingContext & {recordedAt: number}>} PendingLocks
 * @typedef {Record<string, PendingContext & {operationGeneration: number}>} PendingEntries
 * @typedef {{
 *   begin(context: PendingContext): PendingOperation | null,
 *   finish(operation: PendingOperation): void,
 *   isPending(resourceId: string): boolean,
 *   pending(): PendingEntries, locks(): PendingLocks,
 *   setLocks(locks: PendingLocks): void, setPending(pending: PendingEntries): void,
 *   tracker: PendingTracker
 * }} MutationPendingHarness
 */

/** @param {string} source @param {string} name @param {string} parameters */
function extractedFunction(source, name, parameters) {
  return `function ${name}(${parameters}) {${functionBody(source, name)}}`;
}

/** @param {string} source @param {(typeof MUTATION_PENDING_CASES)[number]} testCase */
function pendingHarnessSource(source, testCase) {
  const { bindings } = testCase;
  return `
    let mutationStorageReady = true;
    let ${bindings.locks} = {};
    let ${bindings.pending} = {};
    const ${bindings.tracker} = tracker;
    function ${bindings.key}(action, resourceId) {
      return keyFactory(action, resourceId);
    }
    ${extractedFunction(source, bindings.pendingForResource, testCase.resourceArgument)}
    ${extractedFunction(source, bindings.busy, testCase.resourceArgument)}
    ${extractedFunction(source, bindings.begin, "ownerContext")}
    ${extractedFunction(source, bindings.finish, "operation")}
    return {
      begin: ${bindings.begin},
      finish: ${bindings.finish},
      isPending: ${bindings.pendingForResource},
      pending: () => ${bindings.pending},
      locks: () => ${bindings.locks},
      setLocks: (nextLocks) => { ${bindings.locks} = nextLocks; },
      setPending: (nextPending) => { ${bindings.pending} = nextPending; },
      tracker,
    };
  `;
}

/** @param {string} source @param {(typeof MUTATION_PENDING_CASES)[number]} testCase @returns {MutationPendingHarness} */
function createMutationPendingHarness(source, testCase) {
  const createHarness = new Function(
    "tracker",
    "keyFactory",
    pendingHarnessSource(source, testCase),
  );
  return createHarness(
    createKeyedSingleFlightTracker(),
    /** @param {string} action @param {string} resourceId */
    (action, resourceId) => `${action}:${resourceId}`,
  );
}

/** @param {(typeof MUTATION_PENDING_CASES)[number]} testCase */
async function loadMutationPendingHarness(testCase) {
  return createMutationPendingHarness(
    await routeSource(testCase.route),
    testCase,
  );
}

/** @param {string} source @param {string} functionName @param {string} mutationCall */
function expectCancelBeforeMutation(source, functionName, mutationCall) {
  const body = functionBody(source, functionName);
  const confirmationOffset = body.indexOf("confirm(");
  const beginOffset = body.indexOf("begin");
  const mutationOffset = body.indexOf(mutationCall);
  expect(confirmationOffset).toBeGreaterThanOrEqual(0);
  expect(body.slice(confirmationOffset, beginOffset)).toContain("return");
  expect(beginOffset).toBeGreaterThan(confirmationOffset);
  expect(mutationOffset).toBeGreaterThan(beginOffset);
}

/** @param {string} source @param {string} marker */
function buttonElementContaining(source, marker) {
  let buttonOffset = source.indexOf("<button");
  while (buttonOffset >= 0) {
    const buttonEnd = source.indexOf("</button", buttonOffset);
    if (buttonEnd < 0) break;
    const button = source.slice(buttonOffset, buttonEnd);
    if (button.includes(marker)) return button;
    buttonOffset = source.indexOf("<button", buttonEnd);
  }
  throw new Error(`Missing button containing ${marker}`);
}

describe("Users viewport menu", () => {
  /** @typedef {{top: number, right: number, bottom: number}} AnchorRect */
  /** @typedef {{width: number, height: number}} MenuSize */
  /** @typedef {{top: number, left: number}} MenuPosition */
  class MenuButton {
    /** @param {AnchorRect} rect */
    constructor(rect) { this.rect = rect; }
    getBoundingClientRect() { return this.rect; }
  }

  /**
   * @param {string} source
   * @param {() => Promise<void>} [tick]
   */
  function menuHarness(source, tick = async () => {}) {
    /** @type {Map<string, {listener: () => void, capture: boolean}>} */
    const listeners = new Map();
    const viewport = {
      innerWidth: 390,
      innerHeight: 844,
      /** @param {string} name @param {() => void} listener @param {boolean} [capture] */
      addEventListener(name, listener, capture = false) {
        listeners.set(name, { listener, capture });
      },
      /** @param {string} name @param {() => void} listener @param {boolean} [capture] */
      removeEventListener(name, listener, capture = false) {
        const installed = listeners.get(name);
        expect(installed).toEqual({ listener, capture });
        listeners.delete(name);
      },
    };
    /** @type {{
     * toggle(userId: string, event: {currentTarget: unknown, stopPropagation(): void}): Promise<void>,
     * close(): void,
     * state(): {id: string | null, position: MenuPosition | null},
     * position(anchor: AnchorRect, menu: MenuSize, viewport: MenuSize): MenuPosition,
     * dispose(): void
     * }} */
    const controller = new Function("window", "HTMLButtonElement", "tick", `
      let openMenuId = null;
      let openMenuPosition = null;
      let menuGeneration = 0;
      const menuElement = {getBoundingClientRect: () => ({width: 176, height: 140})};
      ${extractedFunction(source, "closeMenu", "")}
      ${extractedFunction(source, "observeMenuViewport", "")}
      ${extractedFunction(source, "menuPosition", "anchor, menu, viewport")}
      async function toggleMenu(userId, evt) {${functionBody(source, "toggleMenu")}}
      const dispose = observeMenuViewport();
      return {toggle: toggleMenu, close: closeMenu, position: menuPosition, dispose,
        state: () => ({id: openMenuId, position: openMenuPosition})};
    `)(viewport, MenuButton, tick);
    return { controller, listeners };
  }

  test("positions the measured menu within mobile edges and flips above a bottom-row button", async () => {
    const { controller } = menuHarness(await routeSource("users/+page.svelte"));
    expect(controller.position(
      { top: 200, bottom: 232, right: 374 }, { width: 176, height: 140 }, { width: 390, height: 844 },
    )).toEqual({ top: 236, left: 198 });
    expect(controller.position(
      { top: 810, bottom: 842, right: 420 }, { width: 176, height: 140 }, { width: 390, height: 844 },
    )).toEqual({ top: 666, left: 206 });
    expect(controller.position(
      { top: -50, bottom: -18, right: 30 }, { width: 176, height: 140 }, { width: 390, height: 844 },
    )).toEqual({ top: 8, left: 8 });
    expect(controller.position(
      { top: 120, bottom: 152, right: 190 }, { width: 184, height: 144 }, { width: 200, height: 160 },
    )).toEqual({ top: 8, left: 8 });
    controller.dispose();
  });

  test("guards the event currentTarget and uses the triggering button bounds", async () => {
    const source = await routeSource("users/+page.svelte");
    const { controller } = menuHarness(source);
    let stopped = 0;
    await controller.toggle("user-1", { currentTarget: null, stopPropagation() { stopped++; } });
    expect(controller.state()).toEqual({ id: null, position: null });
    const button = new MenuButton({ top: 200, bottom: 232, right: 374 });
    const event = { currentTarget: button, stopPropagation() { stopped++; } };
    await controller.toggle("user-1", event);
    expect(controller.state()).toEqual({ id: "user-1", position: { top: 236, left: 198 } });
    await controller.toggle("user-1", event);
    expect(controller.state()).toEqual({ id: null, position: null });
    expect(stopped).toBe(3);
    expect(source).toContain('class="fixed z-30 w-44');
    expect(source).toContain("bind:this={menuElement}");
    controller.dispose();
  });

  test("closes on captured scroll and resize and removes both listeners", async () => {
    const { controller, listeners } = menuHarness(await routeSource("users/+page.svelte"));
    for (const name of ["scroll", "resize"]) {
      await controller.toggle("user-1", {
        currentTarget: new MenuButton({ top: 200, bottom: 232, right: 374 }),
        stopPropagation() {},
      });
      const installed = listeners.get(name);
      if (!installed) throw new Error(`Missing ${name} listener`);
      expect(installed.capture).toBe(name === "scroll");
      installed.listener();
      expect(controller.state()).toEqual({ id: null, position: null });
    }
    controller.dispose();
    expect(listeners.size).toBe(0);
  });

  test("does not position a menu closed before its render completes", async () => {
    const gate = deferredRequest();
    const { controller } = menuHarness(await routeSource("users/+page.svelte"), () => gate.promise);
    const opening = controller.toggle("user-1", {
      currentTarget: new MenuButton({ top: 200, bottom: 232, right: 374 }),
      stopPropagation() {},
    });
    controller.close();
    gate.resolve();
    await opening;
    expect(controller.state()).toEqual({ id: null, position: null });
    controller.dispose();
  });
});

describe("Users and Organizations high-impact mutations", () => {
  test("extracts generic typed handlers without mistaking type or string braces for the body", async () => {
    const body = functionBody(
      '<script lang="ts">async function submit<T>(owner: { id: string }, write: () => Promise<T>) { const marker: string = "}"; return await write(); }</script>',
      "submit",
    );
    const run = new Function("write", `return (async () => {${body}})();`);
    expect(await run(() => Promise.resolve("confirmed"))).toBe("confirmed");
    expect(body).not.toContain(": string");
    expect(body).not.toContain("Promise<T>");
    expect(() => functionBody("function other() {}", "missing")).toThrow();
  });

  test("releases only the matching pending generation after stale read-back", async () => {
    for (const testCase of MUTATION_PENDING_CASES) {
      const harness = await loadMutationPendingHarness(testCase);
      const ownerContext = testCase.staleContext;
      const operation = harness.begin(ownerContext);
      expect(operation).not.toBeNull();
      if (!operation) throw new Error("Expected mutation operation");
      harness.setLocks({
        [`${ownerContext.action}:${ownerContext.resourceId}`]: {
          ...ownerContext,
          recordedAt: 1,
        },
      });

      harness.tracker.invalidate(operation.key);
      harness.finish(operation);

      expect(harness.isPending(ownerContext.resourceId)).toBe(false);
      expect(Object.keys(harness.pending())).toHaveLength(0);
      expect(Object.keys(harness.locks())).toHaveLength(1);
    }
  });

  test("does not let an old finally delete a newer operation pending entry", async () => {
    for (const testCase of MUTATION_PENDING_CASES) {
      const harness = await loadMutationPendingHarness(testCase);
      const ownerContext = testCase.staleContext;
      const firstOperation = harness.begin(ownerContext);
      expect(firstOperation).not.toBeNull();
      if (!firstOperation) throw new Error("Expected first mutation operation");
      harness.tracker.invalidate(firstOperation.key);
      harness.setPending({});
      const secondOperation = harness.begin(ownerContext);
      expect(secondOperation).not.toBeNull();
      if (!secondOperation) throw new Error("Expected second mutation operation");

      harness.finish(firstOperation);
      expect(harness.isPending(ownerContext.resourceId)).toBe(true);
      expect(Object.keys(harness.pending())).toHaveLength(1);
      harness.finish(secondOperation);
      expect(harness.isPending(ownerContext.resourceId)).toBe(false);
    }
  });

  test("releases pending on the normal current-generation finish", async () => {
    for (const testCase of MUTATION_PENDING_CASES) {
      const harness = await loadMutationPendingHarness(testCase);
      const ownerContext = testCase.normalContext;
      const operation = harness.begin(ownerContext);
      expect(operation).not.toBeNull();
      if (!operation) throw new Error("Expected mutation operation");
      expect(harness.isPending(ownerContext.resourceId)).toBe(true);
      harness.finish(operation);
      expect(harness.isPending(ownerContext.resourceId)).toBe(false);
      expect(Object.keys(harness.pending())).toHaveLength(0);
    }
  });

  test("keeps a deferred double click to one request for the same action key", async () => {
    const tracker = createKeyedSingleFlightTracker();
    let requestCount = 0;
    /** @type {() => void} */
    let releaseRequest = () => { throw new Error("Request gate not initialized"); };
    /** @type {Promise<void>} */
    const requestGate = new Promise((resolve) => {
      /** @type {() => void} */
      const release = () => resolve(undefined);
      releaseRequest = release;
    });

    async function runMutation() {
      const operation = tracker.begin("delete:user-one");
      if (!operation) return false;
      requestCount += 1;
      await requestGate;
      tracker.finish(operation);
      return true;
    }

    const first = runMutation();
    const second = runMutation();
    expect(requestCount).toBe(1);
    expect(await second).toBe(false);
    releaseRequest();
    expect(await first).toBe(true);
  });

  test("keeps cancellation ahead of every destructive request", async () => {
    const users = await routeSource("users/+page.svelte");
    const organizations = await routeSource("organizations/+page.svelte");
    /** @type {[string, string, string][]} */
    const cases = [
      [users, "handleToggleSuspend", "suspendUser("],
      [users, "handleDelete", "deleteUser("],
      [users, "handleResetFactor", "resetUserMfa("],
      [organizations, "removeOrganization", "deleteOrganization("],
    ];
    for (const [source, functionName, mutationCall] of cases) {
      expectCancelBeforeMutation(source, functionName, mutationCall);
    }
  });

  test("persists a reload lock before each request and reads authority afterward", async () => {
    const users = await routeSource("users/+page.svelte");
    const organizations = await routeSource("organizations/+page.svelte");
    /** @type {[string, string, string, string, string, string][]} */
    const cases = [
      [users, "handleCreateUser", "createUser(", "readCompleteUserSearch(", "stageUserMutation(", "submitUserMutation("],
      [users, "handleToggleSuspend", "suspendUser(", "readUserDetail(", "stageUserMutation(", "submitUserMutation("],
      [users, "handleDelete", "deleteUser(", "userDeletedFromReadBack(", "stageUserMutation(", "submitUserMutation("],
      [users, "handleResetFactor", "resetUserMfa(", "readUserDetail(", "stageUserMutation(", "submitUserMutation("],
      [organizations, "createNewOrganization", "createOrganization(", "readCompleteOrganizationSearch(", "stageOrganizationMutation(", "submitOrganizationMutation("],
      [organizations, "removeOrganization", "deleteOrganization(", "organizationDeletedFromReadBack(", "stageOrganizationMutation(", "submitOrganizationMutation("],
    ];
    for (const [source, functionName, mutationCall, readBackCall, stageCall, submitCall] of cases) {
      const body = functionBody(source, functionName);
      const mutationOffset = body.indexOf(mutationCall);
      expect(body.indexOf(stageCall)).toBeLessThan(mutationOffset);
      expect(body.lastIndexOf(readBackCall)).toBeGreaterThan(mutationOffset);
      expect(body).toContain("isCurrent(operation)");
      expect(body).toContain(submitCall);
    }
    expect(functionBody(users, "submitUserMutation")).toContain(
      "mutationOutcomeUnknown(requestError)",
    );
    expect(functionBody(organizations, "submitOrganizationMutation")).toContain(
      "mutationOutcomeUnknown(requestError)",
    );
  });

  test("validates the explicit organization slug before beginning a mutation", async () => {
    const organizations = await routeSource("organizations/+page.svelte");
    const body = functionBody(organizations, "createNewOrganization");
    const failureBody = functionBody(
      organizations,
      "reportOrganizationMutationFailure",
    );
    const validationOffset = body.indexOf("organizationSlugIssue(draft.slug)");
    const beginOffset = body.indexOf("beginOrganizationMutation(");
    const requestOffset = body.indexOf("createOrganization(draft)");

    expect(validationOffset).toBeGreaterThanOrEqual(0);
    expect(validationOffset).toBeLessThan(beginOffset);
    expect(beginOffset).toBeLessThan(requestOffset);
    expect(organizations).toContain(
      'let newOrganization = $state({ name: "", slug: "", description: "" })',
    );
    expect(organizations).toContain(
      'newOrganization = { name: "", slug: "", description: "" }',
    );
    expect(hasErrorCodeComparison(failureBody, "validation_error")).toBe(true);
    expect(failureBody).toContain('t("organizations.createValidationError")');
  });

  test("provides a constrained and accessible organization slug field", async () => {
    const organizations = await routeSource("organizations/+page.svelte");
    const slugFieldStart = organizations.indexOf('id="org-slug"');
    const slugFieldEnd = organizations.indexOf("/>", slugFieldStart);
    const slugField = organizations.slice(slugFieldStart, slugFieldEnd);

    expect(slugFieldStart).toBeGreaterThanOrEqual(0);
    expect(slugField).toContain("required");
    expect(slugField).toContain('minlength="2"');
    expect(slugField).toContain('maxlength="120"');
    expect(slugField).toContain('pattern="[a-z0-9]+(?:-[a-z0-9]+)*"');
    expect(slugField).toContain('aria-describedby="org-slug-help org-slug-error"');
    expect(organizations).toContain('for="org-slug"');
    expect(organizations).toContain('id="org-slug-help"');
    expect(organizations).toContain('id="org-slug-error"');
  });

  test("separates search and create actions and hides the empty state behind the form", async () => {
    const organizations = await routeSource("organizations/+page.svelte");
    const requestStateStart = organizations.indexOf("<RequestState");
    const requestStateEnd = organizations.indexOf(
      "</RequestState>",
      requestStateStart,
    );
    const requestState = organizations.slice(requestStateStart, requestStateEnd);
    const searchButton = buttonElementContaining(
      organizations,
      't("organizations.search")',
    );
    const createButton = buttonElementContaining(
      organizations,
      "createNewOrganization",
    );
    const cancelButton = buttonElementContaining(
      organizations,
      "showCreate = false",
    );

    expect(searchButton).toContain("bg-brand-600");
    expect(createButton).toContain("bg-brand-600");
    expect(cancelButton).toContain("border-surface-300");
    expect(organizations).toContain('t("organizations.subtitle")');
    expect(organizations).toContain(
      "empty={organizations.length === 0 && !showCreate}",
    );
    const populatedGuard = requestState.indexOf(
      "{#if organizations.length > 0}",
    );
    const organizationGrid = requestState.indexOf(
      'class="grid gap-4 lg:grid-cols-2"',
    );
    const resultFooter = requestState.indexOf('t("organizations.resultCount"');
    const populatedGuardEnd = requestState.lastIndexOf("{/if}");
    expect(populatedGuard).toBeGreaterThanOrEqual(0);
    expect(organizationGrid).toBeGreaterThan(populatedGuard);
    expect(resultFooter).toBeGreaterThan(organizationGrid);
    expect(populatedGuardEnd).toBeGreaterThan(resultFooter);
  });

  test("requires observable identities and state transitions before clearing locks", async () => {
    const users = await routeSource("users/+page.svelte");
    const organizations = await routeSource("organizations/+page.svelte");
    expect(users).toContain("createdUserFromReadBack");
    expect(users).toContain("beforeUserIds");
    const suspendBody = functionBody(users, "handleToggleSuspend");
    expect(suspendBody).toContain(
      "isSuspended(readBackUser) !== shouldSuspend",
    );
    expect(suspendBody).toContain("userMutationUnknown()");
    expect(functionBody(users, "handleResetFactor")).toContain(
      "factorStillPresent",
    );
    expect(functionBody(users, "handleDelete")).toContain(
      "userDeletedFromReadBack(",
    );
    expect(organizations).toContain("createdOrganizationFromReadBack");
    expect(organizations).toContain("beforeOrganizationIds");
    expect(functionBody(organizations, "removeOrganization")).toContain(
      "organizationDeletedFromReadBack(",
    );
  });

  test("restores durable unknown locks and fails closed when storage is unavailable", async () => {
    const users = await routeSource("users/+page.svelte");
    const organizations = await routeSource("organizations/+page.svelte");
    /** @type {[string, string, string, string, string][]} */
    const cases = [
      [users, "supaoauth.admin.user-mutation-locks.v1", "restoreUserMutationLocks", "load", "acknowledgeUserMutation"],
      [organizations, "supaoauth.admin.organization-mutation-locks.v1", "restoreOrganizationMutationLocks", "loadOrganizations", "acknowledgeOrganizationMutation"],
    ];
    for (const [source, storageKey, restoreName, loadName, acknowledgeName] of cases) {
      expect(source).toContain(storageKey);
      expect(source).toContain(`function ${restoreName}(`);
      expect(source).toContain("globalThis.localStorage.setItem(");
      expect(source).toContain("mutationStorageReady = false");
      expect(source).toContain("{#if mutationStorageError}");
      expect(source).toContain("acknowledge");
      expect(functionBody(source, acknowledgeName).match(/confirm\(/g)).toHaveLength(
        2,
      );
      expect(functionBody(source, loadName)).not.toContain(
        "mutationStorageError = null",
      );
    }
  });

  test("disables every high-impact control while its resource is blocked", async () => {
    const users = await routeSource("users/+page.svelte");
    const organizations = await routeSource("organizations/+page.svelte");
    /** @type {[string, string, string][]} */
    const cases = [
      [users, "handleCreateUser", 'userResourceBusy("new")'],
      [users, "handleToggleSuspend(user)", "userResourceBusy(user.id)"],
      [users, "handleDelete(user)", "userResourceBusy(user.id)"],
      [users, "handleResetFactor(factor.id)", "userResourceBusy(detail.id)"],
      [organizations, "createNewOrganization", 'organizationResourceBusy("new")'],
      [organizations, "removeOrganization(organization.id)", "organizationResourceBusy(organization.id)"],
    ];
    for (const [source, marker, guard] of cases) {
      const button = buttonElementContaining(source, marker);
      expect(button).toContain("disabled={");
      expect(button).toContain("mutationStorageReady");
      expect(button).toContain(guard);
    }
  });

  test("rejects malformed read-back and stale generations", () => {
    expect(() => collectionPage({ unexpected: [] })).toThrow(
      "unknown collection envelope",
    );
    expect(() =>
      collectionPage({ items: [{ id: "one" }], total: 2, page: 1, limit: 1 }),
    ).not.toThrow();
    const requests = createLatestRequestTracker();
    const stale = requests.begin("users", { page: 1 });
    const current = requests.begin("users", { page: 2 });
    expect(requests.isCurrent(stale)).toBe(false);
    expect(requests.isCurrent(current)).toBe(true);
  });

  test("classifies interrupted writes without inventing success", () => {
    expect(
      mutationOutcomeUnknown(
        new AdminApiError("commit response lost", 0, "request_timeout"),
      ),
    ).toBe(true);
    expect(mutationOutcomeUnknown(new TypeError("network failed"))).toBe(true);
    expect(
      mutationOutcomeUnknown(new AdminApiError("upstream failed", 503, "upstream")),
    ).toBe(true);
    expect(
      mutationOutcomeUnknown(new AdminApiError("invalid request", 400, "invalid")),
    ).toBe(false);
  });
});
