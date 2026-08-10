import { describe, expect, test } from "bun:test";
import { normalizeAuthHookSecret } from "./auth-hook-secret.js";

describe("Auth Hook signing secret", () => {
  const encodedSecret = Buffer.alloc(24, 1).toString("base64");

  test("normalizes a valid raw Base64 key to the canonical Standard Webhooks format", () => {
    const maximumEncodedSecret = Buffer.alloc(64, 2).toString("base64");
    expect(normalizeAuthHookSecret(encodedSecret)).toBe(`v1,whsec_${encodedSecret}`);
    expect(normalizeAuthHookSecret(`v1,whsec_${encodedSecret}`)).toBe(`v1,whsec_${encodedSecret}`);
    expect(normalizeAuthHookSecret(maximumEncodedSecret)).toBe(`v1,whsec_${maximumEncodedSecret}`);
  });

  test("keeps an empty replacement optional and rejects malformed or unsafe keys", () => {
    expect(normalizeAuthHookSecret("  ")).toBe("");
    expect(normalizeAuthHookSecret("not-base64")).toBeNull();
    expect(normalizeAuthHookSecret("v1,whsec_not-base64")).toBeNull();
    expect(normalizeAuthHookSecret(Buffer.alloc(23, 1).toString("base64"))).toBeNull();
    expect(normalizeAuthHookSecret(Buffer.alloc(65, 1).toString("base64"))).toBeNull();
  });
});
