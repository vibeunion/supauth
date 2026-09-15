import { readFile } from 'node:fs/promises';
import { describe, expect, test } from "bun:test";
import ts from "typescript";
import { groupCapabilityEntries } from "./capability-view.js";

/** @param {string} relativePath */
async function source(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8');
}

/** @param {string} source @param {string} method @param {string} path @param {string} endpoint */
function routeResponse(source, method, path, endpoint) {
  const file = ts.createSourceFile("routes.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  /** @type {import("typescript").Expression[]} */
  const responses = [];
  /** @param {import("typescript").Node} node */
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === method) {
      const [routePath, handler] = node.arguments;
      if (routePath && ts.isStringLiteral(routePath) && routePath.text === path &&
        handler && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) {
        if (ts.isBlock(handler.body)) {
          for (const statement of handler.body.statements) {
            if (ts.isReturnStatement(statement) && statement.expression) responses.push(statement.expression);
          }
        } else responses.push(handler.body);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  expect(responses).toHaveLength(1);
  let response = responses[0];
  if (!response) throw new Error(`Missing response for ${method} ${path}`);
  if (ts.isCallExpression(response) && ts.isIdentifier(response.expression) &&
    response.expression.text === "decodeEndpointResponse") {
    const [endpointName, decodedValue] = response.arguments;
    expect(endpointName && ts.isStringLiteral(endpointName) ? endpointName.text : null).toBe(endpoint);
    if (!decodedValue) throw new Error(`Missing decoded value for ${endpoint}`);
    response = decodedValue;
  }
  return { file, expression: response };
}

/** @param {ReturnType<typeof routeResponse>} response @param {string} callee */
function responseCallArgument(response, callee) {
  const expression = response.expression;
  expect(ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)
    ? expression.expression.text : null).toBe(callee);
  if (!ts.isCallExpression(expression) || !expression.arguments[0]) {
    throw new Error(`Missing ${callee} argument`);
  }
  return { ...response, expression: expression.arguments[0] };
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
        source: "gotrue",
        version: null,
        last_verified_at: "2026-01-01T00:00:00Z",
      },
      custom_reserved_capability: {
        available: false,
        reason_code: "capability_negotiation_unavailable",
        source: "supaoauth",
        version: null,
        last_verified_at: "2026-01-01T00:00:00Z",
      },
      gotrue_auth_hooks_v1: {
        available: true,
        reason_code: null,
        source: "gotrue",
        version: null,
        last_verified_at: "2026-01-01T00:00:00Z",
      },
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
    expect(applicationList).toContain('<OneTimeSecret secret={revealedSecrets[app.client_id] || ""}');
    expect(oneTimeSecret).toContain("navigator.clipboard.writeText(secret)");
    expect(oneTimeSecret).toContain("$effect(() => {");
    expect(applicationPage).toContain('application.client_type !== "public"');
    expect(applicationList).toContain('app.client_type !== "public"');
    expect(applicationList).toContain("authMethodLabel(app.token_endpoint_auth_method)");
    expect(applicationPage).toContain('? ["none"] : confidentialAuthMethods');
    expect(applicationPage).toContain("application.secret.publicClient");
    expect(oneTimeSecret).toContain("application.secret.shownOnce");
    const listed = routeResponse(applicationRoutes, "get", "/", "listApplications");
    responseCallArgument(responseCallArgument(listed, "withoutSecrets"), "pagedResponse");
    const detail = responseCallArgument(
      routeResponse(applicationRoutes, "get", "/:appId", "getApplication"), "withoutSecrets",
    );
    expect(detail.expression.getText(detail.file)).toBe("await oauthClientAdapter().getOAuthClient(params.appId)");
    const updated = responseCallArgument(
      routeResponse(applicationRoutes, "put", "/:appId", "updateApplication"), "withoutSecrets",
    );
    expect(updated.expression.getText(updated.file)).toBe("updated");
    const created = routeResponse(applicationRoutes, "post", "/", "createApplication");
    expect(created.expression.getText(created.file)).toBe("created");
    const rotated = routeResponse(applicationRoutes, "post", "/:appId/rotate-secret", "rotateApplicationSecret");
    expect(rotated.expression.getText(rotated.file)).toBe("result");
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
