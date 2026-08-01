import { afterEach, describe, expect, it, mock } from 'bun:test';

const getSecurityConfig = mock(async () => null);
mock.module('../repositories/security-config.js', () => ({ getSecurityConfig }));

const originalFetch = globalThis.fetch;

function setSupacloudFunctionEnv() {
  process.env.SUPACLOUD_API_URL = '';
  process.env.SUPACLOUD_MASTER_TOKEN = '';
  process.env.PROJECT_REF = '';
  process.env.OAUTH_RUNTIME_URL = '';
  process.env.DATABASE_URL = '';
  process.env.SUPACLOUD_INTERNAL_API_URL = 'http://supacloud.internal';
  process.env.SUPACLOUD_INTERNAL_TOKEN = 'test-token';
  process.env.SUPAOAUTH_BFF_SIGNING_SECRET = 'test-bff-signing-secret-32-characters';
  process.env.SUPACLOUD_PROJECT_REF = 'test-project';
  process.env.SUPACLOUD_RUNTIME_URL = 'http://runtime.internal';
  process.env.SUPACLOUD_DATABASE_URL = 'postgres://test';
  process.env.ADMIN_AUTH_MODE = 'token';
  process.env.ADMIN_TOKEN = 'test-admin-token';
  process.env.NODE_ENV = 'test';
}

setSupacloudFunctionEnv();

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('SupAuth function entrypoint', () => {
  it('does not bind a standalone server when imported', async () => {
    setSupacloudFunctionEnv();

    const { app, handleSupAuthRequest } = await import('../index.js');

    expect(app.server).toBeNull();

    const response = await handleSupAuthRequest(new Request('http://supauth.local/v1/health'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      runtime_mode: 'gotrue',
    });
    expect(app.server).toBeNull();
  });

  it('accepts SupaCloud manifest /api routes without a standalone proxy', async () => {
    setSupacloudFunctionEnv();
    const supauthFunction = (await import('../supacloud-function.js')).default;

    const response = await supauthFunction.fetch(new Request('http://supauth.local/api/v1/health'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      runtime_mode: 'gotrue',
    });
  });

  it('accepts direct SupaCloud function invoke paths', async () => {
    setSupacloudFunctionEnv();
    const supauthFunction = (await import('../supacloud-function.js')).default;

    const response = await supauthFunction.fetch(
      new Request('http://runtime.local/functions/v1/supauth/api/v1/health'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      runtime_mode: 'gotrue',
    });
  });

  it('rejects anonymous project reads before calling SupaCloud', async () => {
    setSupacloudFunctionEnv();
    const upstreamFetch = mock(async () => Response.json({ ref: 'must-not-be-returned' }));
    globalThis.fetch = upstreamFetch as unknown as typeof fetch;
    const { handleSupAuthRequest } = await import('../index.js');

    const response = await handleSupAuthRequest(new Request('http://supauth.local/v1/project'));

    expect(response.status).toBe(401);
    expect(upstreamFetch).toHaveBeenCalledTimes(0);
  });

  it('returns only the project metadata required by the Admin Console', async () => {
    setSupacloudFunctionEnv();
    const upstreamFetch = mock(async () => Response.json({
      id: 'project-id',
      ref: 'test-project',
      project_ref: 'test-project',
      name: 'Test Project',
      region: 'test-region',
      status: 'ACTIVE_HEALTHY',
      database_url: 'must-not-leak',
      secret: 'must-not-leak',
      config: {
        jwt: { keys: [{ d: 'must-not-leak', k: 'must-not-leak' }] },
      },
    }));
    globalThis.fetch = upstreamFetch as unknown as typeof fetch;
    const { handleSupAuthRequest } = await import('../index.js');

    const loginResponse = await handleSupAuthRequest(new Request('http://supauth.local/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'test-admin-token' }),
    }));
    const { token } = await loginResponse.json() as { token: string };
    const response = await handleSupAuthRequest(new Request('http://supauth.local/v1/project', {
      headers: { authorization: `Bearer ${token}` },
    }));
    const project = await response.json();

    expect(response.status).toBe(200);
    expect(project).toEqual({
      id: 'project-id',
      ref: 'test-project',
      project_ref: 'test-project',
      name: 'Test Project',
    });
    expect(JSON.stringify(project)).not.toMatch(/"(?:config|database_url|d|k|secret)":/);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it('keeps health, runtime health, and public SSO metadata anonymous', async () => {
    setSupacloudFunctionEnv();
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url).pathname;
      if (path.endsWith('/.well-known/openid-configuration')) {
        return Response.json({
          issuer: 'http://runtime.internal',
          authorization_endpoint: 'http://runtime.internal/authorize',
          token_endpoint: 'http://runtime.internal/token',
          userinfo_endpoint: 'http://runtime.internal/userinfo',
          jwks_uri: 'http://runtime.internal/.well-known/jwks.json',
          id_token_signing_alg_values_supported: ['ES256'],
        });
      }
      return Response.json({ keys: [] });
    }) as unknown as typeof fetch;
    const { handleSupAuthRequest } = await import('../index.js');

    for (const path of ['/v1/health', '/v1/runtime/health', '/v1/public/admin-sso-config']) {
      const response = await handleSupAuthRequest(new Request(`http://supauth.local${path}`));
      expect(response.status).toBe(200);
    }
  });
});
