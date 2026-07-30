// Bun runs this module directly; the Svelte check does not include Bun's test globals.
// @ts-nocheck
import { afterEach, describe, expect, mock, test } from "bun:test";
import { AdminApiError, setAdminAuthenticatedFetch } from "../admin-api.js";
import * as adminClient from "./client.js";
import {
  getCapabilities,
  getProject,
  getUser,
  listUsers,
  listWebhookDeliveries,
  uploadFile,
} from "./client.js";

afterEach(() => {
  setAdminAuthenticatedFetch(null);
});

describe("admin business API authentication recovery", () => {
  test("delegates JSON requests to the refresh-aware fetch layer", async () => {
    const fetcher = mock(
      async () =>
        new Response(JSON.stringify({ ref: "project-ref" }), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    setAdminAuthenticatedFetch(fetcher);

    await expect(getProject()).resolves.toEqual({ ref: "project-ref" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("accepts the single replay performed by the authenticated fetch layer", async () => {
    const transport = mock()
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ref: "project-ref" }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    const authenticatedFetch = mock(async (input, init) => {
      const firstResponse = await transport(input, init);
      return firstResponse.status === 401
        ? transport(input, init)
        : firstResponse;
    });
    setAdminAuthenticatedFetch(authenticatedFetch);

    await expect(getProject()).resolves.toEqual({ ref: "project-ref" });
    expect(authenticatedFetch).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  test("keeps 403 structured without attempting a replay", async () => {
    const transport = mock(
      async () =>
        new Response(
          JSON.stringify({
            code: "insufficient_permissions",
            message: "Forbidden",
          }),
          {
            status: 403,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );
    const authenticatedFetch = mock(async (input, init) => {
      const response = await transport(input, init);
      return response.status === 401 ? transport(input, init) : response;
    });
    setAdminAuthenticatedFetch(authenticatedFetch);

    try {
      await getProject();
      throw new Error("Expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AdminApiError);
      expect(error).toMatchObject({
        statusCode: 403,
        code: "insufficient_permissions",
      });
    }
    expect(transport).toHaveBeenCalledTimes(1);
  });

  test("preserves binary bodies and explicit content types", async () => {
    const file = new Blob(["brand"], { type: "image/png" });
    const fetcher = mock(async (_input, init) => {
      expect(init.body).toBe(file);
      expect(new Headers(init.headers).get("Content-Type")).toBe("image/png");
      return new Response(JSON.stringify({ path: "branding/logo.png" }), {
        headers: { "Content-Type": "application/json" },
      });
    });
    setAdminAuthenticatedFetch(fetcher);

    await expect(
      uploadFile("branding", "logo.png", file, file.type),
    ).resolves.toEqual({ path: "branding/logo.png" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("keeps paged control-plane reads behind the /api/v1 BFF", async () => {
    const requestedUrls = [];
    const fetcher = mock(async (input) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify({ items: [], total: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    });
    setAdminAuthenticatedFetch(fetcher);

    await getCapabilities();
    await listUsers({ page: 2, limit: 25, search: "alice@example.com" });
    await listWebhookDeliveries("webhook-1", { limit: 10 });

    expect(
      requestedUrls.map((url) => new URL(url, "http://console.local").pathname),
    ).toEqual([
      "/api/v1/capabilities",
      "/api/v1/users",
      "/api/v1/webhooks/webhook-1/deliveries",
    ]);
    expect(requestedUrls[1]).toContain(
      "page=2&limit=25&search=alice%40example.com",
    );
  });

  test("exports only GoTrue-compatible management clients", () => {
    expect(adminClient.listUserPasskeys).toBeUndefined();
    expect(adminClient.listPersonalAccessTokens).toBeUndefined();
    expect(adminClient.exchangeSubjectToken).toBeUndefined();
    expect(adminClient.grantConsent).toBeUndefined();
    expect(adminClient.listApplicationSecrets).toBeUndefined();
    expect(adminClient.createApplicationSecret).toBeUndefined();
    expect(adminClient.listUserSessions).toBeUndefined();
    expect(adminClient.revokeUserSession).toBeUndefined();
    expect(adminClient.unlinkUserIdentity).toBeUndefined();
    expect(adminClient.listUserGrants).toBeFunction();
    expect(adminClient.revokeUserGrant).toBeUndefined();
  });

  test("lists user grants through the encoded read-only BFF path", async () => {
    const fetcher = mock(async (input) => {
      expect(String(input)).toEndWith(
        "/api/v1/users/user%2Fwith%20space/grants",
      );
      return Response.json({ items: [], total: 0, page: 1, limit: 50 });
    });
    setAdminAuthenticatedFetch(fetcher);

    await expect(
      adminClient.listUserGrants("user/with space"),
    ).resolves.toMatchObject({ items: [], total: 0 });
  });

  test("forwards the selected application for user roles and permissions", async () => {
    const requestedUrls = [];
    const fetcher = mock(async (input) => {
      requestedUrls.push(String(input));
      return Response.json({ items: [], total: 0 });
    });
    setAdminAuthenticatedFetch(fetcher);

    await adminClient.getUserRoles("user/one", "application/one");
    await adminClient.getUserPermissions("user/one", "org/one", "application/one");

    expect(requestedUrls[0]).toEndWith(
      "/api/v1/users/user%2Fone/roles?application_id=application%2Fone",
    );
    expect(requestedUrls[1]).toEndWith(
      "/api/v1/users/user%2Fone/permissions?org_id=org%2Fone&application_id=application%2Fone",
    );
  });

  test("encodes untrusted path identifiers before issuing a request", async () => {
    const fetcher = mock(async (input) => {
      expect(String(input)).toEndWith("/api/v1/users/user%2Fwith%20space");
      return new Response(JSON.stringify({ id: "user/with space" }), {
        headers: { "Content-Type": "application/json" },
      });
    });
    setAdminAuthenticatedFetch(fetcher);

    await expect(getUser("user/with space")).resolves.toEqual({
      id: "user/with space",
    });
  });

  test("uses canonical organization and webhook mutation contracts", async () => {
    const requests = [];
    const fetcher = mock(async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    });
    setAdminAuthenticatedFetch(fetcher);

    await adminClient.updateOrganizationJit("org-one", {
      enabled: true,
      domains: ["example.com"],
    });
    await adminClient.upsertOrganizationApplication("org-one", "app-one");
    await adminClient.testWebhook("webhook-one");

    expect(JSON.parse(requests[0].init.body)).toEqual({
      enabled: true,
      domains: ["example.com"],
    });
    expect(requests[1].init.body).toBeUndefined();
    expect(requests[2].init.body).toBeUndefined();
    expect(requests.map(({ url }) => url)).not.toContain("role_ids");
  });

  test("creates audit exports through POST", async () => {
    const fetcher = mock(async (_input, init) => {
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ resource_type: "user" });
      return new Response(JSON.stringify({ id: "export-one" }), {
        headers: { "Content-Type": "application/json" },
      });
    });
    setAdminAuthenticatedFetch(fetcher);

    await expect(
      adminClient.exportAuditLogs({ resource_type: "user" }),
    ).resolves.toEqual({ id: "export-one" });
  });
});
