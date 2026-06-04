import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { loadConfig } from "../config/index.js";

function setupConfig() {
  process.env.OAUTH_RUNTIME_URL = "http://runtime.test";
  process.env.SUPACLOUD_API_URL = "http://localhost:9090";
  process.env.SUPACLOUD_MASTER_TOKEN = "test-token";
  process.env.PROJECT_REF = "test-ref";
  process.env.DATABASE_URL = "postgres://test";
  process.env.RUNTIME_MODE = "gotrue";
  loadConfig();
}

describe("auth config runtime consistency", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    setupConfig();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("detects signup drift when desired config is closed but runtime settings still allow signup", async () => {
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("/v1/projects/test-ref/config/auth")) {
        return Promise.resolve(new Response(JSON.stringify({
          enable_signup: false,
          disable_signup: false,
        }), { status: 200 }));
      }

      if (url.endsWith("/auth/v1/settings")) {
        return Promise.resolve(new Response(JSON.stringify({
          disable_signup: false,
        }), { status: 200 }));
      }

      return Promise.resolve(new Response("not found", { status: 404 }));
    }) as unknown as typeof fetch;

    const { getAuthConfigRuntimeConsistency } = await import("../routes/sign-in-experience.js");
    const result = await getAuthConfigRuntimeConsistency(globalThis.fetch);

    expect(result.consistent).toBe(false);
    expect(result.desired.signups_enabled).toBe(false);
    expect(result.runtime.signups_enabled).toBe(true);
  });

  it("treats runtime signup as closed when /settings reports disable_signup=true", async () => {
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("/v1/projects/test-ref/config/auth")) {
        return Promise.resolve(new Response(JSON.stringify({
          enable_signup: false,
        }), { status: 200 }));
      }

      if (url.endsWith("/auth/v1/settings")) {
        return Promise.resolve(new Response(JSON.stringify({
          disable_signup: true,
        }), { status: 200 }));
      }

      return Promise.resolve(new Response("not found", { status: 404 }));
    }) as unknown as typeof fetch;

    const { getAuthConfigRuntimeConsistency } = await import("../routes/sign-in-experience.js");
    const result = await getAuthConfigRuntimeConsistency(globalThis.fetch);

    expect(result.consistent).toBe(true);
    expect(result.desired.signups_enabled).toBe(false);
    expect(result.runtime.signups_enabled).toBe(false);
  });
});
