import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { loadConfig } from '../config/index.js';
import { observabilityMiddleware } from '../middleware/index.js';

describe('GoTrue OAuth client grant type boundary', () => {
  const originalFetch = globalThis.fetch;
  const upstreamCalls: string[] = [];

  beforeEach(() => {
    process.env.SUPACLOUD_INTERNAL_API_URL = 'http://supacloud.internal';
    process.env.SUPACLOUD_INTERNAL_TOKEN = 'test-token';
    process.env.SUPACLOUD_PROJECT_REF = 'test-project';
    process.env.SUPACLOUD_RUNTIME_URL = 'http://runtime.internal';
    process.env.SUPACLOUD_DATABASE_URL = 'postgres://test';
    delete process.env.SUPAUTH_OAUTH_AUTHORIZATION_PROJECT_REF;
    loadConfig();
    upstreamCalls.length = 0;
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      upstreamCalls.push(url);
      return Promise.resolve(Response.json({ client_id: 'unexpected-upstream-call' }));
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test.each([
    ['POST', '/v1/applications', 'urn:ietf:params:oauth:grant-type:token-exchange'],
    ['POST', '/v1/applications', 'client_credentials'],
    ['PUT', '/v1/applications/client-one', 'token-exchange'],
  ])('rejects unsupported %s grant types before the SupaCloud facade', async (method, path, grantType) => {
    const { applicationRoutes } = await import('../routes/applications.js');
    const app = new Elysia().use(observabilityMiddleware).use(applicationRoutes);
    const response = await app.handle(new Request(`http://supauth.local${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Unsupported client',
        redirect_uris: ['https://client.example.test/callback'],
        grant_types: ['authorization_code', grantType],
      }),
    }));
    const payload = await response.json() as {
      error?: { code?: string; details?: { allowed_grant_types?: string[]; unsupported_grant_types?: string[] } };
    };

    expect(response.status).toBe(400);
    expect(payload.error?.code).toBe('unsupported_grant_type');
    expect(payload.error?.details?.allowed_grant_types).toEqual(['authorization_code', 'refresh_token']);
    expect(payload.error?.details?.unsupported_grant_types).toEqual([grantType]);
    expect(upstreamCalls).toHaveLength(0);
  });

  test.each([
    ['POST', '/v1/applications'],
    ['PUT', '/v1/applications/client-one'],
  ])('rejects an explicitly empty %s allowlist before the SupaCloud facade', async (method, path) => {
    const { applicationRoutes } = await import('../routes/applications.js');
    const app = new Elysia().use(observabilityMiddleware).use(applicationRoutes);
    const response = await app.handle(new Request(`http://supauth.local${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: ['https://client.example.test/callback'],
        grant_types: [],
      }),
    }));

    expect(response.status).toBe(400);
    expect(upstreamCalls).toHaveLength(0);
  });
});
