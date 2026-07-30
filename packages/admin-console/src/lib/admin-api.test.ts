// Bun runs this module directly; the Svelte check does not include Bun's test globals.
// @ts-nocheck
import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  AdminApiError,
  adminApiRequest,
  setAdminAuthenticatedFetch,
} from "./admin-api.js";

afterEach(() => {
  setAdminAuthenticatedFetch(null);
});

describe("admin API authentication recovery", () => {
  test("uses the refresh-aware fetch layer when the installed SSO provider exposes it", async () => {
    const fetcher = mock(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    setAdminAuthenticatedFetch(fetcher);

    await expect(adminApiRequest("/v1/auth/identity")).resolves.toEqual({
      ok: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("keeps successful empty responses nullable", async () => {
    setAdminAuthenticatedFetch(
      mock(async () => new Response(null, { status: 200 })),
    );

    await expect(adminApiRequest("/v1/auth/logout")).resolves.toBeNull();
  });

  test("keeps 204 responses nullable without reading a body", async () => {
    setAdminAuthenticatedFetch(
      mock(async () => new Response(null, { status: 204 })),
    );

    await expect(adminApiRequest("/v1/auth/logout")).resolves.toBeNull();
  });

  test("returns successful non-JSON response bodies as text", async () => {
    setAdminAuthenticatedFetch(
      mock(async () => new Response("accepted", { status: 202 })),
    );

    await expect(adminApiRequest("/v1/jobs/1")).resolves.toBe("accepted");
  });

  test("preserves an exhausted authenticated retry as a terminal structured error", async () => {
    setAdminAuthenticatedFetch(
      mock(
        async () =>
          new Response(
            JSON.stringify({
              error_code: "invalid_token",
              message: "Unauthorized",
            }),
            {
              status: 401,
              headers: {
                "Content-Type": "application/json",
                "X-Svadmin-Auth-Retry": "exhausted",
              },
            },
          ),
      ),
    );

    await expect(adminApiRequest("/v1/users")).rejects.toMatchObject({
      statusCode: 401,
      code: "auth_retry_exhausted",
      body: { error_code: "invalid_token", message: "Unauthorized" },
    });
  });

  test("keeps 403 distinct from authentication expiry", async () => {
    setAdminAuthenticatedFetch(
      mock(
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
      ),
    );

    try {
      await adminApiRequest("/v1/audit");
      throw new Error("Expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AdminApiError);
      expect(error).toMatchObject({
        statusCode: 403,
        code: "insufficient_permissions",
      });
      expect(error.message).toBe("[403 Forbidden] Forbidden");
    }
  });

  test.each([
    [404, "Not Found"],
    [501, "Capability Unavailable"],
    [503, "Service Unavailable"],
  ])(
    "labels %s responses without converting them to empty success",
    async (statusCode, statusLabel) => {
      setAdminAuthenticatedFetch(
        mock(
          async () => new Response("upstream response", { status: statusCode }),
        ),
      );

      await expect(adminApiRequest("/v1/resource")).rejects.toMatchObject({
        statusCode,
        message: `[${statusCode} ${statusLabel}] upstream response`,
      });
    },
  );
});
