// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { AdminApiError } from "./admin-api.js";
import {
  applicationDetailTabValues,
  capabilityAvailable,
  collectionItems,
  requestErrorState,
  tabFromRoute,
} from "./resource-page.js";

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
