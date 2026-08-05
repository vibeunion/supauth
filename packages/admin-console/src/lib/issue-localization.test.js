import { expect, test } from "bun:test";
import { t } from "./i18n.js";

test("localizes the issue-facing JWT, Webhook, audit, and tenant labels", () => {
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => "zh-CN" };
  try {
    expect(t("jwt.hookState.inactive")).toBe("未生效");
    expect(t("jwt.verifyRuntimeHook")).toBe("验证运行时 Hook");
    expect(t("webhooks.createFailed")).toStartWith("Webhook 创建失败");
    expect(t("audit.export")).toBe("导出");
    expect(t("audit.filter.eventType")).toBe("事件类型");
    expect(t("audit.exportStatus.completed")).toBe("已完成");
    expect(t("tenant.members.title")).toBe("租户成员");
    expect(t("tenant.warning.adminTokenEnabled")).not.toContain("admin_auth_mode");
    expect(t("tenant.domainsDescription")).not.toContain("runtime");
    expect(t("tenant.signingKeyCount", { count: 1 })).toBe("1 个");
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});
