import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  authHookStatusIsActive,
  parseAuthHookStatus,
} from "./auth-hook-status.js";

const jwtPageSource = readFileSync(
  new URL("../routes/customize-jwt/+page.svelte", import.meta.url),
  "utf8",
);

describe("JWT Auth Hook authoritative status", () => {
  test("accepts only coherent boolean status read-back", () => {
    expect(parseAuthHookStatus({
      registered: true,
      verified: true,
      reason_code: null,
    })).toEqual({ registered: true, verified: true, reason_code: null });
    expect(parseAuthHookStatus({
      registered: false,
      verified: false,
      reason_code: "gotrue_hook_not_enabled",
    })).toEqual({
      registered: false,
      verified: false,
      reason_code: "gotrue_hook_not_enabled",
    });
    for (const invalidStatus of [
      null,
      {},
      { registered: "yes", verified: true },
      { registered: false, verified: true },
      { registered: true, verified: true, reason_code: "" },
      { registered: true, verified: true, reason_code: false },
    ]) expect(parseAuthHookStatus(invalidStatus)).toBeNull();
  });

  test("reports active only after both authority flags are true", () => {
    expect(authHookStatusIsActive({ registered: true, verified: true })).toBe(true);
    expect(authHookStatusIsActive({ registered: true, verified: false })).toBe(false);
    expect(authHookStatusIsActive(null)).toBe(false);
  });

  test("gates the success message behind the authoritative status read-back", () => {
    const verifyStart = jwtPageSource.indexOf("async function verifyHook");
    const verifyEnd = jwtPageSource.indexOf("</script>", verifyStart);
    const verifySource = jwtPageSource.slice(verifyStart, verifyEnd);

    expect(verifySource.indexOf("getCustomAccessTokenHookStatus()"))
      .toBeLessThan(verifySource.indexOf("authHookStatusIsActive(authoritativeStatus)"));
    expect(verifySource.indexOf("authHookStatusIsActive(authoritativeStatus)"))
      .toBeLessThan(verifySource.lastIndexOf("verificationMessage ="));
  });
});
