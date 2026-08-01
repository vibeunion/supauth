// @ts-nocheck
import { afterEach, describe, expect, mock, test } from "bun:test";
import { setAdminAuthenticatedFetch } from "./admin-api.js";
import {
  listApplications,
  listOrganizations,
  listUsers,
} from "./api/client.js";
import {
  collectionPage,
  completeCursorCollectionItems,
  completeCollectionItems,
  cursorCollectionPage,
  createLatestRequestTracker,
  emptyCollectionFallbackPage,
  isLatestResourceLoad,
  mergeCollectionPages,
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

function numberedTargetPage(page, limit = 25, total = 125) {
  const firstNumber = (page - 1) * limit + 1;
  const finalNumber = Math.min(page * limit, total);
  const items = Array.from(
    { length: Math.max(0, finalNumber - firstNumber + 1) },
    (_, offset) => ({ id: `target-${firstNumber + offset}` }),
  );
  return { items, total, page, limit };
}

function targetRequestIsCurrent(tracker, request, currentPageContext) {
  return (
    tracker.isCurrent(request) &&
    isLatestResourceLoad(request.ownerContext.pageContext, currentPageContext)
  );
}

afterEach(() => {
  setAdminAuthenticatedFetch(null);
});

describe("collection pagination boundaries", () => {
  test("accepts complete and partial cursor envelopes at the webhook boundary", () => {
    const completeEnvelope = {
      items: [{ id: "delivery-one" }],
      total: 1,
      limit: 100,
      next_cursor: null,
    };
    expect(cursorCollectionPage(completeEnvelope)).toEqual({
      items: completeEnvelope.items,
      total: 1,
      limit: 100,
      nextCursor: null,
    });
    expect(completeCursorCollectionItems(completeEnvelope)).toEqual(
      completeEnvelope.items,
    );

    const partialEnvelope = {
      items: [{ id: "delivery-one" }],
      total: 2,
      limit: 1,
      next_cursor: "cursor-two",
    };
    expect(cursorCollectionPage(partialEnvelope).nextCursor).toBe("cursor-two");
    expect(() => completeCursorCollectionItems(partialEnvelope)).toThrow(
      "partial cursor collection",
    );
  });

  test("fails closed on malformed or inconsistent cursor envelopes", () => {
    const validEnvelope = {
      items: [{ id: "delivery-one" }],
      total: 1,
      limit: 100,
      next_cursor: null,
    };
    for (const malformedEnvelope of [
      { ...validEnvelope, next_cursor: undefined },
      { ...validEnvelope, total: "1" },
      { ...validEnvelope, limit: 0 },
      { ...validEnvelope, items: {} },
      { ...validEnvelope, total: 2 },
      { ...validEnvelope, next_cursor: "cursor-two" },
      { ...validEnvelope, items: Array.from({ length: 101 }, () => ({})) },
    ]) {
      expect(() => cursorCollectionPage(malformedEnvelope)).toThrow(
        /cursor collection/,
      );
    }
  });

  test("preserves trusted page metadata", () => {
    expect(
      collectionPage({
        data: {
          items: [{ id: "target-51" }],
          total: 125,
          page: 3,
          limit: 25,
        },
      }),
    ).toEqual({
      items: [{ id: "target-51" }],
      total: 125,
      page: 3,
      limit: 25,
      complete: false,
    });
  });

  test("rejects a partial collection without navigable metadata", () => {
    expect(() =>
      collectionPage({ items: [{ id: "target-1" }], total: 125 }),
    ).toThrow("partial collection without pagination metadata");
  });

  test("requires complete data when a caller has no navigation", () => {
    expect(() =>
      completeCollectionItems(numberedTargetPage(1)),
    ).toThrow("partial collection where no navigation is available");
    expect(
      completeCollectionItems({
        applications: [{ id: "app-1" }, { id: "app-2" }],
        total: 2,
        page: 1,
        limit: 25,
      }),
    ).toHaveLength(2);
  });

  test("moves an empty out-of-range page back to the current final page", () => {
    expect(
      emptyCollectionFallbackPage(
        collectionPage({ items: [], total: 25, page: 2, limit: 25 }),
        2,
      ),
    ).toBe(1);
    expect(
      emptyCollectionFallbackPage(
        collectionPage({ items: [], total: 0, page: 5, limit: 25 }),
        5,
      ),
    ).toBe(1);
    expect(
      emptyCollectionFallbackPage(
        collectionPage({ items: [], total: 26, page: 2, limit: 25 }),
        2,
      ),
    ).toBeNull();
    expect(
      emptyCollectionFallbackPage(
        collectionPage({ items: [], total: 0, page: 1, limit: 25 }),
        1,
      ),
    ).toBeNull();
  });
});

describe("management list request contracts", () => {
  test("sends paging and search only to endpoints that support them", async () => {
    const requestedUrls = [];
    setAdminAuthenticatedFetch(
      mock(async (input) => {
        requestedUrls.push(String(input));
        return Response.json({ items: [], total: 0, page: 1, limit: 25 });
      }),
    );

    await listUsers({ page: 3, limit: 25, search: "target-51" });
    await listOrganizations({
      page: 5,
      limit: 25,
      search: "target-125",
      application_id: "app-1",
    });
    await listApplications();

    const [usersUrl, organizationsUrl, applicationsUrl] = requestedUrls.map(
      (requestedUrl) => new URL(requestedUrl, "http://console.local"),
    );
    expect(Object.fromEntries(usersUrl.searchParams)).toEqual({
      page: "3",
      limit: "25",
      search: "target-51",
    });
    expect(Object.fromEntries(organizationsUrl.searchParams)).toEqual({
      page: "5",
      limit: "25",
      search: "target-125",
      application_id: "app-1",
    });
    expect(applicationsUrl.search).toBe("");
  });
});

describe("organization list coordination", () => {
  test("keeps stale success, failure, and finally handlers from overwriting current state", async () => {
    const requests = createLatestRequestTracker();
    const state = {
      organizations: [{ id: "current" }],
      total: 1,
      loading: true,
      error: null,
    };
    const staleSuccess = deferredRequest();
    const firstRequest = requests.begin("organizations", {
      page: 1,
      limit: 25,
      search: "old",
    });
    const firstLoad = staleSuccess.promise
      .then((response) => {
        const page = collectionPage(response);
        if (!requests.isCurrent(firstRequest)) return;
        state.organizations = page.items;
        state.total = page.total;
      })
      .finally(() => {
        if (requests.isCurrent(firstRequest)) state.loading = false;
      });

    requests.begin("organizations", { page: 1, limit: 25, search: "new" });
    staleSuccess.resolve({ items: [{ id: "stale" }], total: 1 });
    await firstLoad;

    const staleFailure = deferredRequest();
    const failedRequest = requests.begin("organizations", {
      page: 2,
      limit: 25,
      search: "older",
    });
    const failedLoad = staleFailure.promise
      .catch((requestError) => {
        if (requests.isCurrent(failedRequest)) state.error = requestError;
      })
      .finally(() => {
        if (requests.isCurrent(failedRequest)) state.loading = false;
      });
    requests.begin("organizations", { page: 1, limit: 25, search: "newest" });
    staleFailure.reject(new Error("stale organization failure"));
    await failedLoad;

    expect(state).toEqual({
      organizations: [{ id: "current" }],
      total: 1,
      loading: true,
      error: null,
    });
  });

  test("wires page, limit, search, and all state commits to the current request", async () => {
    const pageSource = await Bun.file(
      new URL("../routes/organizations/+page.svelte", import.meta.url),
    ).text();
    const loadBody = functionBody(pageSource, "loadOrganizations");

    expect(loadBody).toContain('organizationRequests.begin("organizations"');
    expect(loadBody).toContain("page: currentPage");
    expect(loadBody).toContain("limit: pageLimit");
    expect(loadBody).toContain("search");
    expect(loadBody).toContain("listOrganizations(request.ownerContext)");
    expect(loadBody).toContain("emptyCollectionFallbackPage(");
    expect(loadBody).toContain("await loadOrganizations()");
    expect(
      loadBody.match(/organizationRequests\.isCurrent\(request\)/g),
    ).toHaveLength(3);
  });
});

describe("role assignment target reachability", () => {
  test("reaches the 51st and 125th targets through merged pages or remote search", () => {
    let loadedTargets = collectionPage(numberedTargetPage(1)).items;
    for (let page = 2; page <= 5; page += 1) {
      const nextPage = collectionPage(numberedTargetPage(page));
      loadedTargets = mergeCollectionPages(
        loadedTargets,
        nextPage.items,
        (target) => target.id,
      );
    }
    expect(loadedTargets.some((target) => target.id === "target-51")).toBe(true);
    expect(loadedTargets.some((target) => target.id === "target-125")).toBe(
      true,
    );

    const searchPage = collectionPage({
      items: [{ id: "target-51" }],
      total: 1,
      page: 1,
      limit: 25,
    });
    expect(searchPage.items.map((target) => target.id)).toEqual(["target-51"]);
  });

  test("rejects stale searches and stale role page generations", () => {
    const requests = createLatestRequestTracker();
    const currentPageContext = {
      generation: 2,
      resourceId: "role-current",
      tab: "assignments",
    };
    const staleSearch = requests.begin("users", {
      pageContext: currentPageContext,
      search: "old",
    });
    const currentSearch = requests.begin("users", {
      pageContext: currentPageContext,
      search: "new",
    });
    expect(targetRequestIsCurrent(requests, staleSearch, currentPageContext)).toBe(
      false,
    );
    expect(
      targetRequestIsCurrent(requests, currentSearch, currentPageContext),
    ).toBe(true);

    const staleRoleRequest = requests.begin("organizations", {
      pageContext: {
        generation: 1,
        resourceId: "role-previous",
        tab: "assignments",
      },
      search: "",
    });
    expect(
      targetRequestIsCurrent(requests, staleRoleRequest, currentPageContext),
    ).toBe(false);
  });

  test("wires paged users and organizations while filtering complete applications locally", async () => {
    const pageSource = await Bun.file(
      new URL("../routes/roles/+page.svelte", import.meta.url),
    ).text();
    const userLoad = functionBody(pageSource, "loadUserTargets");
    const organizationLoad = functionBody(
      pageSource,
      "loadOrganizationTargets",
    );
    const applicationLoad = functionBody(pageSource, "loadApplicationTargets");
    const targetQuery = functionBody(pageSource, "targetPageQuery");
    const targetMerge = functionBody(pageSource, "mergedTargetPage");
    const targetTypeChange = functionBody(
      pageSource,
      "changeAssignmentTargetType",
    );

    for (const loadBody of [userLoad, organizationLoad]) {
      expect(loadBody).toContain("targetPageQuery(request)");
      expect(loadBody).toContain("collectionPage(");
    }
    expect(targetQuery).toContain("page: request.ownerContext.page");
    expect(targetQuery).toContain("limit: TARGET_PAGE_LIMIT");
    expect(targetQuery).toContain("search: request.ownerContext.search");
    expect(targetMerge).toContain('request.ownerContext.mode === "append"');
    expect(targetMerge).toContain("mergeCollectionPages(");
    expect(userLoad).toContain("listUsers(targetPageQuery(request))");
    expect(organizationLoad).toContain(
      "listOrganizations(targetPageQuery(request))",
    );
    expect(applicationLoad).toContain("await listApplications()");
    expect(applicationLoad).not.toMatch(/listApplications\s*\(\s*\{/);
    expect(applicationLoad).toContain("completeCollectionItems(response)");
    expect(pageSource).toContain("const term = normalizeText(targetSearch)");
    expect(pageSource).toContain("users.length < userTargetTotal");
    expect(pageSource).toContain(
      "organizations.length < organizationTargetTotal",
    );
    expect(targetTypeChange).toContain("event.currentTarget.value");
    expect(targetTypeChange).toContain("userTargetError = null");
    expect(targetTypeChange).toContain("loadUserTargets(currentPageLoadContext())");
  });
});
