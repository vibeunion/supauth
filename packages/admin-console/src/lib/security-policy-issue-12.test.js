import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { t } from "./i18n.js";
import { blocklistHookReasonKey } from "../routes/security/blocklist-hook-reason.js";

const securityPageSource = readFileSync(
  new URL("../routes/security/+page.svelte", import.meta.url),
  "utf8",
);
const originalLocalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
let locale = "en";
const ISSUE_FACING_COPY = {
  "security.passwordRequiredCharacters": ["Required characters", "必需字符"],
  "security.captchaProvider": ["Provider", "提供商"],
  "security.captchaSecretConfigured": ["Secret configured", "已配置密钥"],
  "security.blocklistNotEffective": ["Not effective", "未生效"],
  "security.blocklistAllowedEmailDomains": [
    "Allowed email domains",
    "允许的邮箱域名",
  ],
  "security.blocklistInviteOnly": [
    "Invite-only sign-up",
    "仅限受邀用户注册",
  ],
  "security.blocklistReasonProcessUnavailable": [
    "The GoTrue process is unavailable. Start or repair the managed GoTrue service, then verify this policy again.",
    "GoTrue 进程不可用。请启动或修复托管 GoTrue 服务，然后重新验证此策略。",
  ],
  "security.blocklistReasonUnavailable": [
    "The GoTrue before-user-created hook is not verified. Check the managed runtime configuration and try again.",
    "GoTrue before-user-created Hook 尚未通过验证。请检查托管运行时配置后重试。",
  ],
};

beforeAll(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key) {
        return key === "supaoauth.locale" ? locale : null;
      },
    },
  });
});

afterAll(() => {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
  } else {
    delete globalThis.localStorage;
  }
});

describe("CNB issue 12 security policy", () => {
  test("keeps the password, CAPTCHA, and blocklist controls reachable", () => {
    for (const controlId of [
      "password-min-length",
      "password-character-policy",
      "captcha-provider",
      "captcha-secret",
      "allowed-domains",
      "blocked-domains",
      "blocked-providers",
      "allowed-providers",
    ]) {
      expect(securityPageSource).toContain(`id="${controlId}"`);
    }
    for (const characterPolicy of ["none", "standard", "strong"]) {
      expect(securityPageSource).toContain(`value="${characterPolicy}"`);
    }
    expect(securityPageSource).toContain(
      "bind:checked={blocklistForm.invite_only}",
    );
  });

  test("maps upstream Hook reasons to stable copy without exposing raw codes", () => {
    expect(
      blocklistHookReasonKey(
        "gotrue_before_user_created_hook_process_unavailable",
      ),
    ).toBe("security.blocklistReasonProcessUnavailable");
    expect(blocklistHookReasonKey("gotrue_hook_not_enabled")).toBe(
      "security.blocklistReasonNotEnabled",
    );
    expect(blocklistHookReasonKey("future_upstream_reason")).toBe(
      "security.blocklistReasonUnavailable",
    );
    expect(blocklistHookReasonKey("__proto__")).toBe(
      "security.blocklistReasonUnavailable",
    );
    expect(securityPageSource).not.toContain(
      ">{blocklistForm.hook_reason_code}</code",
    );
    expect(securityPageSource).not.toContain("<code");
  });

  test("reports Active only when registration and runtime verification pass", () => {
    expect(securityPageSource).toContain(
      "blocklistForm.hook_registered && blocklistForm.hook_verified",
    );
    expect(securityPageSource).toContain('t("security.blocklistNotEffective")');
    expect(securityPageSource).not.toContain(
      "hook_reason_code = null",
    );
  });

  test("provides English and Chinese copy for every issue-facing label", () => {
    for (const [key, [english, chinese]] of Object.entries(ISSUE_FACING_COPY)) {
      locale = "en";
      expect(t(key)).toBe(english);
      locale = "zh-CN";
      expect(t(key)).toBe(chinese);
    }
  });
});
