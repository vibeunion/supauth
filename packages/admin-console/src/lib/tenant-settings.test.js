import { describe, expect, test } from "bun:test";
import {
  adminAuthModeLabelKey,
  invitationStatusLabelKey,
  parseTenantConfigValue,
  securityWarningLabelKey,
  tenantRoleLabelKey,
} from "./tenant-settings.js";

describe("tenant settings presentation", () => {
  test("parses only complete JSON objects", () => {
    expect(parseTenantConfigValue('{"provider":"none"}')).toEqual({
      valid: true,
      config: { provider: "none" },
    });
    for (const invalidSource of [
      '{ “provider”: “none” }',
      '{"provider":"none"',
      "",
      "   ",
      "[]",
      "null",
      undefined,
    ]) expect(parseTenantConfigValue(invalidSource).valid).toBe(false);
    expect(parseTenantConfigValue('{"provider":"captcha"}')).toEqual({
      valid: true,
      config: { provider: "captcha" },
    });
  });

  test("maps runtime codes and warnings to stable localized labels", () => {
    expect(adminAuthModeLabelKey("sso")).toBe("tenant.adminAuthMode.sso");
    expect(adminAuthModeLabelKey("future-mode")).toBe("tenant.adminAuthMode.unknown");
    expect(adminAuthModeLabelKey("toString")).toBe("tenant.adminAuthMode.unknown");
    expect(securityWarningLabelKey("admin_token_enabled"))
      .toBe("tenant.warning.adminTokenEnabled");
    expect(securityWarningLabelKey("future_warning"))
      .toBe("tenant.warning.unknown");
    expect(securityWarningLabelKey("constructor"))
      .toBe("tenant.warning.unknown");
  });

  test("maps member codes without exposing unknown values", () => {
    expect(tenantRoleLabelKey("owner")).toBe("tenant.role.owner");
    expect(invitationStatusLabelKey("pending"))
      .toBe("tenant.invitationStatus.pending");
    for (const unknownCode of ["billing_admin", "constructor", null, 42]) {
      expect(tenantRoleLabelKey(unknownCode)).toBe("tenant.role.unknown");
      expect(invitationStatusLabelKey(unknownCode))
        .toBe("tenant.invitationStatus.unknown");
    }
  });
});
