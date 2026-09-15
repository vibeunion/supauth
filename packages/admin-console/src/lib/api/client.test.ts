import { afterEach, describe, expect, mock, test } from "bun:test";
import { adminEndpoints, type AdminEndpointResult } from "@supauth/shared";
import { adminEndpointRequest, adminUploadRequest, setAdminAuthenticatedFetch, type AdminFetch } from "../admin-api.js";
import * as adminClient from "./client.js";

const project = { id: "project-ref", ref: "project-ref", name: "Project" } satisfies AdminEndpointResult<"getProject">;
const user = {
  id: "user/with space", aud: "authenticated", app_metadata: {}, user_metadata: {},
  created_at: "2026-09-08T00:00:00Z",
} satisfies AdminEndpointResult<"getUser">;
const customUi = {
  status: "disabled", configured: false, enabled: false, lifecycle_state: null,
  assets_id: null, content_sha256: null, uploaded_at: null, file_count: 0, files: [],
  cleanup_pending: false, audit_pending: false,
} satisfies AdminEndpointResult<"getCustomUiStatus">;
const exportedAudit = {
  id: "export-one", project_ref: "project-ref", actor: "admin", format: "jsonl", status: "completed",
  row_count: 0, checksum: null, checkpoint_hash: null,
  filters: { eventType: null, resourceType: "user", resourceId: null, actorId: null, status: null, method: null, from: null, to: null },
  expires_at: "2026-09-09T00:00:00Z", created_at: "2026-09-08T00:00:00Z", completed_at: null,
} satisfies AdminEndpointResult<"exportAuditLogs">;

type CapturedRequest = { url: string; init: RequestInit | undefined };
function readJsonBody(request: CapturedRequest | undefined): unknown {
  if (typeof request?.init?.body !== "string") throw new Error("Expected a JSON request body");
  return JSON.parse(request.init.body);
}
afterEach(() => setAdminAuthenticatedFetch(null));

describe("admin schema-first API", () => {
  test("keeps all 149 public wrappers backed by a concrete shared contract", () => {
    expect(Object.keys(adminClient)).toHaveLength(149);
    for (const name of Object.keys(adminClient)) expect(Object.hasOwn(adminEndpoints, name)).toBe(true);
    expect(adminEndpoints.getApplicationConsent).toBe(adminEndpoints.getApplicationConsentSettings);
    expect(adminEndpoints.downloadAuditExport).toBe(adminEndpoints.getAuditExportDownload);
  });

  test("delegates to the refresh-aware fetch layer and keeps browser cookies", async () => {
    const fetcher = mock<AdminFetch>(async (_input, init) => {
      expect(init?.credentials).toBe("include");
      return Response.json(project);
    });
    setAdminAuthenticatedFetch(fetcher);
    await expect(adminClient.getProject()).resolves.toEqual(project);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("accepts only the replay performed by the authenticated fetch layer", async () => {
    const transport = mock<AdminFetch>()
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      .mockResolvedValueOnce(Response.json(project));
    const fetcher = mock<AdminFetch>(async (input, init) => {
      const first = await transport(input, init);
      return first.status === 401 ? transport(input, init) : first;
    });
    setAdminAuthenticatedFetch(fetcher);
    await expect(adminClient.getProject()).resolves.toEqual(project);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  test.each([401, 403, 503])("does not retry HTTP %s or reinterpret it as invalid payload", async (status) => {
    const fetcher = mock<AdminFetch>(async () => Response.json({ code: "upstream_failure", message: "Failure" }, { status }));
    setAdminAuthenticatedFetch(fetcher);
    await expect(adminClient.getProject()).rejects.toMatchObject({ statusCode: status, code: "upstream_failure" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("preserves binary bodies, file path segments and explicit content types", async () => {
    const file = new Blob(["brand"], { type: "image/png" });
    const result = { key: "branding/folder/logo.png", url: "https://cdn.example.test/logo.png", bucket: "branding", path: "folder/logo.png", public: true } satisfies AdminEndpointResult<"uploadFile">;
    const fetcher = mock<AdminFetch>(async (input, init) => {
      expect(String(input)).toEndWith("/api/v1/storage/upload/branding/folder/logo.png");
      expect(init?.body).toBe(file);
      expect(new Headers(init?.headers).get("Content-Type")).toBe("image/png");
      return Response.json(result);
    });
    setAdminAuthenticatedFetch(fetcher);
    await expect(adminClient.uploadFile("branding", "folder/logo.png", file, "image/png")).resolves.toEqual(result);
  });

  test.each(["IMAGE/PNG", "image/png; charset=utf-8"])("preserves legacy branding media type %s and the original Blob", async (contentType) => {
    const file = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    const result = { url: "https://cdn.example.test/logo.png", assetType: "logo", content_type: "image/png" } satisfies AdminEndpointResult<"uploadBranding">;
    const fetcher = mock<AdminFetch>(async (input, init) => {
      expect(String(input)).toEndWith("/api/v1/storage/branding/logo");
      expect(init?.body).toBe(file);
      expect(init?.credentials).toBe("include");
      expect(new Headers(init?.headers).get("Content-Type")).toBe(contentType);
      return Response.json(result);
    });
    setAdminAuthenticatedFetch(fetcher);
    await expect(adminClient.uploadBranding("logo", file, contentType)).resolves.toEqual(result);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test.each(["application/octet-stream", "image/png-invalid", "image/png, image/jpeg"])("rejects branding media type %s without sending a request", async (contentType) => {
    const fetcher = mock<AdminFetch>(async () => Response.json({}));
    setAdminAuthenticatedFetch(fetcher);
    await expect(adminClient.uploadBranding("logo", new Blob(["invalid"]), contentType))
      .rejects.toMatchObject({ code: "invalid_request" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("reads branding assets and audit exports as authenticated blobs", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const requests: string[] = [];
    setAdminAuthenticatedFetch(mock<AdminFetch>(async (input, init) => {
      requests.push(String(input));
      expect(init?.credentials).toBe("include");
      return new Response(bytes, { headers: { "Content-Type": "image/png" } });
    }));
    const branding = await adminClient.getBrandingAsset("logo");
    expect(branding.type).toBe("image/png");
    expect(new Uint8Array(await branding.arrayBuffer())).toEqual(bytes);
    expect(await adminClient.downloadAuditExport("export-one")).toBeInstanceOf(Blob);
    expect(requests[0]).toEndWith("/api/v1/storage/branding/logo");
    expect(requests[1]).toEndWith("/api/v1/audit/export/export-one/download");
  });

  test("uses typed Custom UI lifecycle results", async () => {
    const requests: CapturedRequest[] = [];
    setAdminAuthenticatedFetch(mock<AdminFetch>(async (input, init) => {
      requests.push({ url: String(input), init });
      return Response.json(init?.method === "DELETE" ? { status: "deleted", deleted_file_count: 0 } : customUi);
    }));
    await expect(adminClient.getCustomUiStatus()).resolves.toEqual(customUi);
    await expect(adminClient.deleteCustomUiAssets()).resolves.toEqual({ status: "deleted", deleted_file_count: 0 });
    expect(requests.map(({ url, init }) => [new URL(url, "https://console.test").pathname, init?.method])).toEqual([
      ["/api/v1/sign-in-experience/custom-ui-assets", "GET"], ["/api/v1/sign-in-experience/custom-ui-assets", "DELETE"],
    ]);
  });

  test("preserves pagination and application filters without including request options", async () => {
    const urls: string[] = [];
    setAdminAuthenticatedFetch(mock<AdminFetch>(async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/capabilities")) return Response.json({ runtime_mode: "gotrue", capabilities: {} });
      if (url.includes("/permissions")) return Response.json({ roles: [], permissions: [], scopes: [] });
      if (url.includes("/deliveries")) return Response.json({ items: [], total: 0, limit: 10, next_cursor: null });
      return Response.json({ items: [], total: 0 });
    }));
    await adminClient.getCapabilities();
    await adminClient.listUsers({ page: 2, limit: 25, search: "alice@example.com" }, { timeoutMs: 500 });
    await adminClient.listWebhookDeliveries("webhook-1", { limit: 10 });
    await adminClient.getUserRoles("user/one", "application/one");
    await adminClient.getUserPermissions("user/one", "org/one", "application/one");
    expect(urls[1]).toEndWith("page=2&limit=25&search=alice%40example.com");
    expect(urls[3]).toEndWith("/user%2Fone/roles?application_id=application%2Fone");
    expect(urls[4]).toEndWith("/user%2Fone/permissions?org_id=org%2Fone&application_id=application%2Fone");
    expect(urls.join(" ")).not.toContain("timeout");
  });

  test("does not export unsupported GoTrue management actions", () => {
    for (const name of ["listUserPasskeys", "listPersonalAccessTokens", "exchangeSubjectToken", "grantConsent",
      "listApplicationSecrets", "createApplicationSecret", "listUserSessions", "revokeUserSession", "unlinkUserIdentity", "revokeUserGrant"]) {
      expect(Object.hasOwn(adminClient, name)).toBe(false);
    }
    expect(adminClient.listUserGrants).toBeFunction();
  });

  test("encodes identifiers and checks user and grant responses", async () => {
    setAdminAuthenticatedFetch(mock<AdminFetch>(async (input) => {
      const url = String(input);
      expect(url).toContain("/users/user%2Fwith%20space");
      return Response.json(url.endsWith("/grants") ? { items: [], total: 0, page: 1, limit: 50 } : user);
    }));
    await expect(adminClient.getUser("user/with space")).resolves.toEqual(user);
    await expect(adminClient.listUserGrants("user/with space")).resolves.toMatchObject({ items: [], total: 0 });
  });

  test("preserves omitted body for binding and webhook test commands", async () => {
    const requests: CapturedRequest[] = [];
    setAdminAuthenticatedFetch(mock<AdminFetch>(async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/jit")) return Response.json({ enabled: true, domains: ["example.com"] });
      if (url.includes("/applications/")) return Response.json({ id: "binding", organization_id: "org-one", application_id: "app-one", created_at: "2026-09-08T00:00:00Z" });
      return Response.json({ queued: true, outbox_id: "outbox", event_id: "event" });
    }));
    await adminClient.updateOrganizationJit("org-one", { enabled: true, domains: ["example.com"] });
    await adminClient.upsertOrganizationApplication("org-one", "app-one");
    await adminClient.testWebhook("webhook-one");
    expect(readJsonBody(requests[0])).toEqual({ enabled: true, domains: ["example.com"] });
    expect(requests[1]?.init?.body).toBeUndefined();
    expect(requests[2]?.init?.body).toBeUndefined();
  });

  test("creates audit exports with a validated POST body", async () => {
    setAdminAuthenticatedFetch(mock<AdminFetch>(async (input, init) => {
      expect(init?.method).toBe("POST");
      expect(readJsonBody({ url: String(input), init })).toEqual({ resource_type: "user" });
      return Response.json(exportedAudit);
    }));
    await expect(adminClient.exportAuditLogs({ resource_type: "user" })).resolves.toEqual(exportedAudit);
  });

  test("rejects invalid input before fetch and keeps diagnostics free of payloads", async () => {
    const fetcher = mock<AdminFetch>(async () => Response.json(project));
    setAdminAuthenticatedFetch(fetcher);
    await expect(adminClient.getUser("..")).rejects.toMatchObject({ code: "invalid_request" });
    await expect(adminClient.uploadFile("branding", "../private", new Blob(["x"]), "image/png")).rejects.toMatchObject({ code: "invalid_request" });
    // @ts-expect-error: 未受类型检查的 JS 调用方也必须被运行时边界拒绝。
    const pending = adminClient.createUser({ password: { token: "must-not-leak" } });
    try {
      await pending;
      throw new Error("Expected an invalid input failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid_request", statusCode: 400 });
      expect(JSON.stringify(error)).not.toContain("must-not-leak");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  test.each([{}, { id: 42 }, "not-json", null])("rejects invalid successful project payload %#", async (payload) => {
    setAdminAuthenticatedFetch(mock<AdminFetch>(async () => Response.json(payload)));
    await expect(adminClient.getProject()).rejects.toMatchObject({ code: "invalid_upstream_response", statusCode: 502 });
  });

  test("rejects undefined and non-JSON metadata before serialization", async () => {
    const fetcher = mock<AdminFetch>(async () => Response.json(user));
    setAdminAuthenticatedFetch(fetcher);
    for (const value of [undefined, new Map([["key", "value"]]), new Set(["value"])]) {
      // @ts-expect-error: 验证未受类型检查的调用方不能借 JSON 序列化丢弃非法字段。
      await expect(adminClient.createUser({ user_metadata: { nested: value } }))
        .rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("normalizes invalid upload envelopes without leaking diagnostics", async () => {
    const fetcher = mock<AdminFetch>(async () => Response.json({}));
    setAdminAuthenticatedFetch(fetcher);
    await expect(adminUploadRequest(adminEndpoints.uploadFile, {
      params: { bucketId: "branding", filePath: "logo.png" },
      // @ts-expect-error: 对未受类型检查的上传调用方校验 header。
      headers: { "Content-Type": { secret: "must-not-leak" } },
    }, new Blob(["x"]))).rejects.toMatchObject({
      code: "invalid_request", statusCode: 400, body: undefined,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("keeps explicit void responses nullable and rejects empty JSON responses", async () => {
    setAdminAuthenticatedFetch(mock<AdminFetch>(async () => new Response(null, { status: 204 })));
    await expect(adminClient.deleteUser("user-one")).resolves.toBeNull();
    await expect(adminClient.getUser("user-one")).rejects.toMatchObject({ code: "invalid_upstream_response" });
  });

  test("keeps timeout and cancellation around the entire schema request", async () => {
    let requestSignal: AbortSignal | null | undefined;
    setAdminAuthenticatedFetch(mock<AdminFetch>(async (_input, init) => {
      requestSignal = init?.signal;
      return new Response(new ReadableStream({ pull() {} }));
    }));
    await expect(adminClient.getProject({ timeoutMs: 5 })).rejects.toMatchObject({ code: "request_timeout" });
    expect(requestSignal?.aborted).toBe(true);
    const caller = new AbortController();
    const pending = adminClient.listUsers({}, { signal: caller.signal });
    await Promise.resolve();
    caller.abort(new Error("must-not-leak"));
    await expect(pending).rejects.toMatchObject({ code: "request_aborted" });
  });

  test("checks cancellation before decoding or sending a request", async () => {
    const caller = new AbortController();
    caller.abort();
    const fetcher = mock<AdminFetch>(async () => Response.json(project));
    setAdminAuthenticatedFetch(fetcher);
    await expect(adminClient.getProject({ signal: caller.signal })).rejects.toMatchObject({ code: "request_aborted" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("rejects schema mismatches without replaying a write", async () => {
    const fetcher = mock<AdminFetch>(async () => Response.json({ client_id: 42, client_secret: "must-not-leak" }));
    setAdminAuthenticatedFetch(fetcher);
    await expect(adminEndpointRequest(adminEndpoints.createApplication, { body: { redirect_uris: ["https://example.test/callback"] } }))
      .rejects.toMatchObject({ code: "invalid_upstream_response", body: undefined });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
