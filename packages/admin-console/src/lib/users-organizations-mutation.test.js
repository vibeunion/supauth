import { describe, expect, test } from "bun:test";
import { AdminApiError } from "./admin-api.js";
import {
  collectionPage,
  createKeyedSingleFlightTracker,
  createLatestRequestTracker,
  mutationOutcomeUnknown,
} from "./resource-page.js";

function functionBody(source, functionName) {
  const signatureOffset = source.indexOf(`function ${functionName}(`);
  expect(signatureOffset).toBeGreaterThanOrEqual(0);
  const bodyStart = source.indexOf("{", signatureOffset);
  let braceDepth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") braceDepth += 1;
    if (source[index] === "}") braceDepth -= 1;
    if (braceDepth === 0) return source.slice(bodyStart + 1, index);
  }
  throw new Error(`Unclosed ${functionName}`);
}

async function routeSource(relativePath) {
  return Bun.file(new URL(`../routes/${relativePath}`, import.meta.url)).text();
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

function extractedFunction(source, name, parameters) {
  return `function ${name}(${parameters}) {${functionBody(source, name)}}`;
}

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

function createMutationPendingHarness(source, testCase) {
  return new Function(
    "tracker",
    "keyFactory",
    pendingHarnessSource(source, testCase),
  )(
    createKeyedSingleFlightTracker(),
    (action, resourceId) => `${action}:${resourceId}`,
  );
}

async function loadMutationPendingHarness(testCase) {
  return createMutationPendingHarness(
    await routeSource(testCase.route),
    testCase,
  );
}

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

describe("Users and Organizations high-impact mutations", () => {
  test("releases only the matching pending generation after stale read-back", async () => {
    for (const testCase of MUTATION_PENDING_CASES) {
      const harness = await loadMutationPendingHarness(testCase);
      const ownerContext = testCase.staleContext;
      const operation = harness.begin(ownerContext);
      expect(operation).not.toBeNull();
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
      harness.tracker.invalidate(firstOperation.key);
      harness.setPending({});
      const secondOperation = harness.begin(ownerContext);
      expect(secondOperation).not.toBeNull();

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
      expect(harness.isPending(ownerContext.resourceId)).toBe(true);
      harness.finish(operation);
      expect(harness.isPending(ownerContext.resourceId)).toBe(false);
      expect(Object.keys(harness.pending())).toHaveLength(0);
    }
  });

  test("keeps a deferred double click to one request for the same action key", async () => {
    const tracker = createKeyedSingleFlightTracker();
    let requestCount = 0;
    let releaseRequest;
    const requestGate = new Promise((resolve) => {
      releaseRequest = resolve;
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
    for (const [source, functionName, mutationCall] of [
      [users, "handleToggleSuspend", "suspendUser("],
      [users, "handleDelete", "deleteUser("],
      [users, "handleResetFactor", "resetUserMfa("],
      [organizations, "removeOrganization", "deleteOrganization("],
    ]) {
      expectCancelBeforeMutation(source, functionName, mutationCall);
    }
  });

  test("persists a reload lock before each request and reads authority afterward", async () => {
    const users = await routeSource("users/+page.svelte");
    const organizations = await routeSource("organizations/+page.svelte");
    for (const [source, functionName, mutationCall, readBackCall, stageCall, submitCall] of [
      [users, "handleCreateUser", "createUser(", "readCompleteUserSearch(", "stageUserMutation(", "submitUserMutation("],
      [users, "handleToggleSuspend", "suspendUser(", "readUserDetail(", "stageUserMutation(", "submitUserMutation("],
      [users, "handleDelete", "deleteUser(", "userDeletedFromReadBack(", "stageUserMutation(", "submitUserMutation("],
      [users, "handleResetFactor", "resetUserMfa(", "readUserDetail(", "stageUserMutation(", "submitUserMutation("],
      [organizations, "createNewOrganization", "createOrganization(", "readCompleteOrganizationSearch(", "stageOrganizationMutation(", "submitOrganizationMutation("],
      [organizations, "removeOrganization", "deleteOrganization(", "organizationDeletedFromReadBack(", "stageOrganizationMutation(", "submitOrganizationMutation("],
    ]) {
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
    expect(failureBody).toContain('requestError?.code === "validation_error"');
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
    for (const [source, storageKey, restoreName, loadName, acknowledgeName] of [
      [users, "supaoauth.admin.user-mutation-locks.v1", "restoreUserMutationLocks", "load", "acknowledgeUserMutation"],
      [organizations, "supaoauth.admin.organization-mutation-locks.v1", "restoreOrganizationMutationLocks", "loadOrganizations", "acknowledgeOrganizationMutation"],
    ]) {
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
    for (const [source, marker, guard] of [
      [users, "handleCreateUser", 'userResourceBusy("new")'],
      [users, "handleToggleSuspend(user)", "userResourceBusy(user.id)"],
      [users, "handleDelete(user)", "userResourceBusy(user.id)"],
      [users, "handleResetFactor(factor.id)", "userResourceBusy(detail.id)"],
      [organizations, "createNewOrganization", 'organizationResourceBusy("new")'],
      [organizations, "removeOrganization(organization.id)", "organizationResourceBusy(organization.id)"],
    ]) {
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
