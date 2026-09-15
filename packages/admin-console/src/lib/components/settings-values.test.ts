import { describe, expect, test } from "bun:test";
import { accountCenterValue, blocklistValue, captchaValue } from "./settings-values.js";
import { auditText } from "./audit-view.js";

describe("settings value boundaries", () => {
  test("absent configuration leaves defaults to the form", () => {
    for (const decode of [accountCenterValue, blocklistValue, captchaValue]) {
      expect(decode(null)).toEqual({});
      expect(decode(undefined)).toEqual({});
      expect(decode({})).toEqual({});
    }
  });

  test("preserves managed account center values", () => {
    const value = {
      enabled: false,
      profile: { edit_mode: "read_only", fields: ["name"] },
      security: { password_change: false, mfa: true },
      delete_account: { enabled: true, url: null },
    };
    expect(accountCenterValue(value)).toEqual(value);
  });

  test("rejects malformed managed fields instead of applying defaults", () => {
    expect(() => accountCenterValue({ security: { mfa: "false" } })).toThrow();
    expect(() => accountCenterValue({ profile: { fields: [null] } })).toThrow();
    expect(() => accountCenterValue({ delete_account: { url: [] } })).toThrow();
    expect(() => captchaValue({ secret_configured: "false" })).toThrow();
    expect(() => blocklistValue({ allowed_email_domains: "example.test" })).toThrow();
    expect(() => blocklistValue({ invite_only: 0 })).toThrow();
  });

  test("preserves captcha and blocklist settings", () => {
    expect(captchaValue({ provider: "hcaptcha", secret_configured: true })).toEqual({
      provider: "hcaptcha", secret_configured: true,
    });
    expect(blocklistValue({ invite_only: false, blocked_oauth_providers: ["github"] })).toEqual({
      invite_only: false, blocked_oauth_providers: ["github"],
    });
  });
});

describe("audit display aliases", () => {
  test("prefers canonical text and preserves legacy aliases", () => {
    expect(auditText({ id: "current", logId: "legacy" }, "id", "logId")).toBe("current");
    expect(auditText({ id: "", logId: "legacy" }, "id", "logId")).toBe("legacy");
  });

  test("does not trust non-text extension fields", () => {
    expect(auditText({ logId: {} }, "logId")).toBe("");
    expect(auditText(null, "id")).toBe("");
  });
});
