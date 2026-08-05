import { describe, expect, test } from "bun:test";
import { compatibilityCheckLabel } from "./compatibility-check-label.js";

function keyWithParams(key, params = {}) {
  return `${key}:${params.checkId || ""}`;
}

describe("compatibility check labels", () => {
  test("maps every current backend check ID without rendering its English message", () => {
    for (const checkId of [
      "sc-1-discovery",
      "sc-2-jwks",
      "sc-3-auth-endpoints",
      "sc-4-issuer",
      "sc-6-supacloud-reachable",
      "sc-7-scopes",
      "rb-4-gotrue-jwt-role-safe",
      "rb-4-jwt-role-check",
      "rb-5-app-metadata-namespace",
      "rb-6-schema-isolation",
    ]) {
      const label = compatibilityCheckLabel({
        check_id: checkId,
        status: "pass",
        message: "raw backend message",
      }, keyWithParams);
      expect(label).toStartWith("jwt.compatibility.");
      expect(label).not.toContain("raw backend message");
    }
  });

  test("keeps unknown checks identifiable without exposing their raw message", () => {
    expect(compatibilityCheckLabel({
      check_id: "future-check",
      status: "warn",
      message: "private upstream detail",
    }, keyWithParams)).toBe("jwt.compatibility.unknown:future-check");
    expect(compatibilityCheckLabel({ check_id: "toString", status: "pass" }, keyWithParams))
      .toBe("jwt.compatibility.unknown:toString");
  });
});
