// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { groupCapabilityEntries } from "./capability-view.js";

async function source(relativePath) {
  return Bun.file(new URL(relativePath, import.meta.url)).text();
}

describe("CNB issues 5-9 regressions", () => {
  test("separates advertised capabilities from fail-closed upstream waits", async () => {
    const dashboard = await source("../routes/dashboard/+page.svelte");
    const capabilityCard = await source("./components/CapabilityStatus.svelte");
    const capabilityView = await source("./capability-view.js");

    expect(dashboard).toContain("currentCapabilityEntries");
    expect(dashboard).toContain("waitingCapabilityEntries");
    expect(capabilityView).toContain('"not_advertised_by_upstream"');
    expect(capabilityView).toContain('"capability_negotiation_unavailable"');
    const grouped = groupCapabilityEntries({
      gotrue_passkey_ceremony: {
        available: false,
        reason_code: "not_advertised_by_upstream",
      },
      custom_reserved_capability: {
        available: false,
        reason_code: "capability_negotiation_unavailable",
      },
      gotrue_auth_hooks_v1: { available: true, reason_code: null },
    });
    expect(grouped.waiting.map(([name]) => name)).toEqual([
      "gotrue_passkey_ceremony",
      "custom_reserved_capability",
    ]);
    expect(grouped.current.map(([name]) => name)).toEqual(["gotrue_auth_hooks_v1"]);
    expect(capabilityCard).not.toContain("{name}</code>");
    expect(capabilityCard).not.toContain("{reasonCode ||");
    expect(capabilityCard).toContain('sourceKeys[authority] || "capability.source.unknown"');
    expect(capabilityCard).toContain("capability.reason.unavailable");
  });

  test("keeps client secrets one-time and hides rotation for public clients", async () => {
    const applicationPage = await source(
      "../routes/applications/[appId]/+page.svelte",
    );
    const applicationRoutes = await source(
      "../../../auth-server/src/routes/applications.ts",
    );

    const applicationList = await source("../routes/applications/+page.svelte");
    const oneTimeSecret = await source("./components/OneTimeSecret.svelte");

    expect(applicationPage).toContain("<OneTimeSecret secret={revealedSecret}");
    expect(applicationList).toContain("<OneTimeSecret secret={revealedSecrets[app.client_id]}");
    expect(oneTimeSecret).toContain("navigator.clipboard.writeText(secret)");
    expect(oneTimeSecret).toContain("$effect(() => {");
    expect(applicationPage).toContain('application.client_type !== "public"');
    expect(applicationList).toContain('app.client_type !== "public"');
    expect(applicationList).toContain("authMethodLabel(app.token_endpoint_auth_method)");
    expect(applicationPage).toContain('? ["none"] : confidentialAuthMethods');
    expect(applicationPage).toContain("application.secret.publicClient");
    expect(oneTimeSecret).toContain("application.secret.shownOnce");
    expect(applicationRoutes).toContain("withoutSecrets(pagedResponse(");
    expect(applicationRoutes).toContain(".get('/:appId', async ({ params }) => withoutSecrets(");
    expect(applicationRoutes).toContain("return withoutSecrets(updated);");
    expect(applicationRoutes).toContain("return created;");
    expect(applicationRoutes).toContain("return result;");
  });

  test("validates accessible branding uploads before authoritative read-back", async () => {
    const editor = await source(
      "./components/sign-in-experience/BrandingEditor.svelte",
    );
    const storageRoutes = await source(
      "../../../auth-server/src/storage/index.ts",
    );

    expect(editor).toContain('for="branding-logo-upload"');
    expect(editor).toContain('for="branding-favicon-upload"');
    expect(editor).toContain("MAX_BRANDING_FILE_SIZE");
    expect(editor).toContain("syncBranding(await getSignInExperience())");
    expect(storageRoutes).toContain("brandingAssetMetadata");
    const brandingRoute = storageRoutes.slice(storageRoutes.indexOf(".post('/branding"));
    expect(brandingRoute.indexOf("await requireSignInExperience()"))
      .toBeLessThan(brandingRoute.indexOf("await storeBrandingFile("));
    expect(storageRoutes).toContain("const file = await request.blob()");
    expect(storageRoutes).toContain("await persistBrandingAssetUrl(assetType, publicUrl)");
    expect(storageRoutes).toContain("`${assetType}/${image.hash}.${image.extension}`");
    expect(storageRoutes).toContain("candidate === 'apple_touch_icon'");
  });

  test("keeps MFA navigation explicit and places save beside the factor limit", async () => {
    const layout = await source("../layouts/AdminLayout.svelte");
    const mfaPage = await source("../routes/mfa/+page.svelte");

    expect(layout).toContain("bg-brand-50 font-semibold text-brand-700");
    expect(mfaPage).toContain('t("mfa.description")');
    expect(mfaPage).toContain('t("mfa.method")');
    expect(mfaPage.indexOf('id="mfa-factor-limit"'))
      .toBeLessThan(mfaPage.indexOf("onclick={saveFactorLimit}"));
  });

  test("allows only the fixed MFA return context and localizes pagination", async () => {
    const mfaPage = await source("../routes/mfa/+page.svelte");
    const usersPage = await source("../routes/users/+page.svelte");

    expect(mfaPage).toContain('?from=mfa`');
    expect(usersPage).toContain('page.url.searchParams.get("from") === "mfa"');
    expect(usersPage).toContain('href={resolve("/mfa")}');
    expect(usersPage).not.toContain("returnTo");
    expect(usersPage).not.toContain("redirectTo");
    expect(usersPage).toContain('t("users.new")');
    expect(usersPage).toContain('t("pagination.previous")');
    expect(usersPage).toContain('t("pagination.next")');
  });

  test("contains the complete Chinese copy required by issues 5-9", async () => {
    const translations = await source("./i18n.js");

    for (const expectedCopy of [
      '"dashboard.currentCapabilities": "当前平台能力"',
      '"capability.reason.notAdvertised": "上游服务尚未广播此能力。"',
      '"application.grantType.authorization_code": "授权码模式"',
      '"application.authMethod.none": "无客户端认证"',
      '"application.secret.copy": "复制密钥"',
      '"signIn.brandingFileTooLarge": "所选图片超过 5MB 限制。"',
      '"mfa.method": "MFA 验证方式"',
      '"users.backToMfa": "返回多因素认证"',
      '"pagination.previous": "上一页"',
      '"pagination.next": "下一页"',
    ]) {
      expect(translations).toContain(expectedCopy);
    }
  });
});
