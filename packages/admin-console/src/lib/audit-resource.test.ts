import { describe, expect, test } from "bun:test";
import { auditResourcePath } from "./audit-resource.js";

describe("audit resource links", () => {
  test("links only resource types with registered detail routes", () => {
    expect(
      auditResourcePath({ resource_type: "application", resource_id: "a/b" }),
    ).toBe("/applications/a%2Fb/settings");
    expect(
      auditResourcePath({ resource_type: "resource", resource_id: "api-one" }),
    ).toBe("/api-resources/api-one/general");
    expect(
      auditResourcePath({ resource_type: "connector", resource_id: "c-one" }),
    ).toBeNull();
  });

  test("does not create links without a canonical resource id", () => {
    expect(auditResourcePath({ resource_type: "user" })).toBeNull();
    expect(auditResourcePath({ resource_type: "__proto__", resource_id: "user-one" })).toBeNull();
    expect(auditResourcePath({ resource_type: "toString", resource_id: "user-one" })).toBeNull();
    expect(auditResourcePath({ resourceType: "user", resourceId: "a/b" })).toBe("/users/a%2Fb/settings");
  });
});
