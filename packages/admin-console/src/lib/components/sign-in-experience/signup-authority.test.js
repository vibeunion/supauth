// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { settleWritesThenReadBack } from "../../mutation-reconciliation.js";
import { resolveAuthoritativeSignupEnabled } from "./signup-authority.js";

const INVALID_AUTHORITY_MESSAGE =
  "GoTrue signup configuration read-back is invalid";

describe("GoTrue signup authority", () => {
  test.each([
    [{ enable_signup: true }, true],
    [{ enable_signup: false }, false],
    [{ disable_signup: true }, false],
    [{ disable_signup: false }, true],
    [{ enable_signup: true, disable_signup: false }, true],
    [{ enable_signup: false, disable_signup: true }, false],
  ])("resolves a valid non-conflicting config %#", (authConfig, expected) => {
    expect(resolveAuthoritativeSignupEnabled(authConfig)).toBe(expected);
  });

  test.each([
    ["missing fields", {}],
    ["null", null],
    ["array", []],
    ["invalid enable type", { enable_signup: "true" }],
    ["invalid disable type", { disable_signup: 0 }],
    ["undefined enable", { enable_signup: undefined }],
    ["undefined disable", { disable_signup: undefined }],
    ["both true conflict", { enable_signup: true, disable_signup: true }],
    ["both false conflict", { enable_signup: false, disable_signup: false }],
  ])("rejects %s instead of choosing an overlay value", (_caseName, authConfig) => {
    expect(() => resolveAuthoritativeSignupEnabled(authConfig)).toThrow(
      INVALID_AUTHORITY_MESSAGE,
    );
  });

  test("keeps GoTrue disabled when only the experience write succeeds", async () => {
    const reconciliation = await settleWritesThenReadBack(
      [
        async () => "experience applied",
        () => Promise.reject(new Error("auth write failed")),
      ],
      () => resolveAuthoritativeSignupEnabled({ disable_signup: true }),
    );

    expect(reconciliation.status).toBe("partial_failure");
    expect(reconciliation.readBackValue).toBe(false);
  });

  test("keeps GoTrue enabled when only the auth write succeeds", async () => {
    const reconciliation = await settleWritesThenReadBack(
      [
        () => Promise.reject(new Error("experience write failed")),
        async () => "auth applied",
      ],
      () => resolveAuthoritativeSignupEnabled({ enable_signup: true }),
    );

    expect(reconciliation.status).toBe("partial_failure");
    expect(reconciliation.readBackValue).toBe(true);
  });

  test.each([
    ["missing", {}],
    ["conflicting", { enable_signup: true, disable_signup: true }],
    ["invalid type", { enable_signup: "true", disable_signup: false }],
  ])(
    "maps %s read-back to readback_failure even when both writes succeed",
    async (_caseName, authConfig) => {
      const reconciliation = await settleWritesThenReadBack(
        [async () => "experience applied", async () => "auth applied"],
        () => resolveAuthoritativeSignupEnabled(authConfig),
      );

      expect(reconciliation.status).toBe("readback_failure");
      expect(reconciliation.writeStatus).toBe("success");
      expect(reconciliation.readBackValue).toBeUndefined();
    },
  );
});
