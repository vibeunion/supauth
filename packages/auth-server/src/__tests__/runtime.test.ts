import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Elysia } from 'elysia';
import { loadConfig } from '../config/index.js';

function setupConfig() {
  process.env.OAUTH_RUNTIME_URL = 'http://runtime.test';
  process.env.OAUTH_RUNTIME_INTERNAL_URL = 'http://runtime-internal.test';
  process.env.SUPAUTH_PUBLIC_URL = 'http://auth.test';
  process.env.SUPACLOUD_API_URL = 'http://localhost:9090';
  process.env.SUPACLOUD_MASTER_TOKEN = 'test-token';
  process.env.PROJECT_REF = 'test-ref';
  process.env.DATABASE_URL = 'postgres://test';
  process.env.RUNTIME_MODE = 'gotrue';
  loadConfig();
}

describe('Runtime health check', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    setupConfig();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns healthy result when discovery is reachable', async () => {
    globalThis.fetch = mock((_input: string | URL | Request) => {
      const url = typeof _input === 'string' ? _input : _input instanceof URL ? _input.toString() : _input.url;
      if (url.includes('/.well-known/openid-configuration')) {
        return Promise.resolve(new Response(JSON.stringify({
          issuer: 'http://runtime.test/auth/v1',
          authorization_endpoint: 'http://runtime.test/auth/v1/authorize',
          token_endpoint: 'http://runtime.test/auth/v1/token',
          userinfo_endpoint: 'http://runtime.test/auth/v1/userinfo',
          jwks_uri: 'http://runtime.test/auth/v1/.well-known/jwks.json',
          id_token_signing_alg_values_supported: ['ES256'],
          scopes_supported: ['openid', 'profile', 'email'],
        }), { status: 200 }));
      }
      if (url.includes('/.well-known/jwks.json')) {
        return Promise.resolve(new Response(JSON.stringify({ keys: [{ kty: 'EC', crv: 'P-256' }] }), { status: 200 }));
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    }) as unknown as typeof fetch;

    const { checkRuntimeHealth } = await import('../runtime/index.js');
    const health = await checkRuntimeHealth();

    expect(health.discovery).toBe(true);
    expect(health.jwks).toBe(true);
    expect(health.authorize).toBe(true);
    expect(health.token).toBe(true);
    expect(health.userinfo).toBe(true);
    expect(health.issuer).toBe('http://runtime.test/auth/v1');
    expect(health.signing_alg).toBe('ES256');
  });

  it('supports direct GoTrue internal runtime without /auth/v1 prefix', async () => {
    globalThis.fetch = mock((_input: string | URL | Request) => {
      const url = typeof _input === 'string' ? _input : _input instanceof URL ? _input.toString() : _input.url;
      if (!url.includes('/auth/v1/') && url.endsWith('/.well-known/openid-configuration')) {
        return Promise.resolve(new Response(JSON.stringify({
          issuer: 'http://runtime.test/auth/v1',
          authorization_endpoint: 'http://runtime.test/auth/v1/oauth/authorize',
          token_endpoint: 'http://runtime.test/auth/v1/oauth/token',
          userinfo_endpoint: 'http://runtime.test/auth/v1/oauth/userinfo',
          jwks_uri: 'http://runtime.test/auth/v1/.well-known/jwks.json',
          id_token_signing_alg_values_supported: ['RS256'],
        }), { status: 200 }));
      }
      if (!url.includes('/auth/v1/') && url.endsWith('/.well-known/jwks.json')) {
        return Promise.resolve(new Response(JSON.stringify({ keys: [{ kty: 'RSA' }] }), { status: 200 }));
      }
      return Promise.resolve(new Response('', { status: 200 }));
    }) as unknown as typeof fetch;

    const { checkRuntimeHealth } = await import('../runtime/index.js');
    const health = await checkRuntimeHealth();

    expect(health.discovery).toBe(true);
    expect(health.jwks).toBe(true);
    expect(health.issuer).toBe('http://runtime.test/auth/v1');
    expect(health.signing_alg).toBe('RS256');
  });

  it('reports the unique JWKS signing algorithm instead of the first supported algorithm', async () => {
    globalThis.fetch = mock((_input: string | URL | Request) => {
      const url = typeof _input === 'string' ? _input : _input instanceof URL ? _input.toString() : _input.url;
      if (url.includes('/.well-known/openid-configuration')) {
        return Promise.resolve(Response.json({
          issuer: 'http://runtime.test/auth/v1',
          id_token_signing_alg_values_supported: ['RS256', 'HS256', 'ES256'],
        }));
      }
      if (url.includes('/.well-known/jwks.json')) {
        return Promise.resolve(Response.json({
          keys: [
            { kty: 'oct', use: 'enc', alg: 'HS256' },
            { kty: 'EC', use: 'sig', alg: 'ES256' },
          ],
        }));
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    }) as unknown as typeof fetch;

    const { checkRuntimeHealth } = await import('../runtime/index.js');
    const health = await checkRuntimeHealth();

    expect(health.jwks).toBe(true);
    expect(health.signing_alg).toBe('ES256');
  });

  it('does not guess a signing algorithm when JWKS contains multiple algorithms', async () => {
    globalThis.fetch = mock((_input: string | URL | Request) => {
      const url = typeof _input === 'string' ? _input : _input instanceof URL ? _input.toString() : _input.url;
      if (url.includes('/.well-known/openid-configuration')) {
        return Promise.resolve(Response.json({
          issuer: 'http://runtime.test/auth/v1',
          id_token_signing_alg_values_supported: ['ES256'],
        }));
      }
      if (url.includes('/.well-known/jwks.json')) {
        return Promise.resolve(Response.json({
          keys: [
            { kty: 'RSA', alg: 'RS256' },
            { kty: 'EC', use: 'sig', alg: 'ES256' },
          ],
        }));
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    }) as unknown as typeof fetch;

    const { checkRuntimeHealth } = await import('../runtime/index.js');
    const health = await checkRuntimeHealth();

    expect(health.jwks).toBe(true);
    expect(health.signing_alg).toBeNull();
  });

  it('falls back to a single discovery algorithm when JWKS has no algorithm metadata', async () => {
    globalThis.fetch = mock((_input: string | URL | Request) => {
      const url = typeof _input === 'string' ? _input : _input instanceof URL ? _input.toString() : _input.url;
      if (url.includes('/.well-known/openid-configuration')) {
        return Promise.resolve(Response.json({
          issuer: 'http://runtime.test/auth/v1',
          id_token_signing_alg_values_supported: ['EdDSA'],
        }));
      }
      if (url.includes('/.well-known/jwks.json')) {
        return Promise.resolve(Response.json({ keys: [{ kty: 'OKP', use: 'sig' }] }));
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    }) as unknown as typeof fetch;

    const { checkRuntimeHealth } = await import('../runtime/index.js');
    const health = await checkRuntimeHealth();

    expect(health.jwks).toBe(true);
    expect(health.signing_alg).toBe('EdDSA');
  });

  it('falls back to the installed public auth gateway when runtime roots are not GoTrue discovery endpoints', async () => {
    globalThis.fetch = mock((_input: string | URL | Request) => {
      const url = typeof _input === 'string' ? _input : _input instanceof URL ? _input.toString() : _input.url;
      if (url === 'http://auth.test/auth/v1/.well-known/openid-configuration') {
        return Promise.resolve(new Response(JSON.stringify({
          issuer: 'http://auth.test/auth/v1',
          authorization_endpoint: 'http://auth.test/auth/v1/oauth/authorize',
          token_endpoint: 'http://auth.test/auth/v1/oauth/token',
          userinfo_endpoint: 'http://auth.test/auth/v1/oauth/userinfo',
          jwks_uri: 'http://auth.test/auth/v1/.well-known/jwks.json',
          id_token_signing_alg_values_supported: ['RS256'],
        }), { status: 200 }));
      }
      if (url === 'http://auth.test/auth/v1/.well-known/jwks.json') {
        return Promise.resolve(new Response(JSON.stringify({ keys: [{ kty: 'RSA' }] }), { status: 200 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    }) as unknown as typeof fetch;

    const { checkRuntimeHealth } = await import('../runtime/index.js');
    const health = await checkRuntimeHealth();

    expect(health.discovery).toBe(true);
    expect(health.jwks).toBe(true);
    expect(health.issuer).toBe('http://auth.test/auth/v1');
  });

  it('returns all false when fetch throws', async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error('network error'))) as unknown as typeof fetch;

    const { checkRuntimeHealth } = await import('../runtime/index.js');
    const health = await checkRuntimeHealth();

    expect(health.discovery).toBe(false);
    expect(health.jwks).toBe(false);
    expect(health.authorize).toBe(false);
    expect(health.token).toBe(false);
    expect(health.userinfo).toBe(false);
    expect(health.issuer).toBeNull();
    expect(health.signing_alg).toBeNull();
  });

  it('returns partial health when discovery returns ok but jwks fails', async () => {
    globalThis.fetch = mock((_input: string | URL | Request) => {
      const url = typeof _input === 'string' ? _input : _input instanceof URL ? _input.toString() : _input.url;
      if (url.includes('/.well-known/openid-configuration')) {
        return Promise.resolve(new Response(JSON.stringify({
          issuer: 'http://runtime.test/auth/v1',
          authorization_endpoint: 'http://runtime.test/auth/v1/authorize',
          token_endpoint: 'http://runtime.test/auth/v1/token',
          userinfo_endpoint: 'http://runtime.test/auth/v1/userinfo',
          jwks_uri: 'http://runtime.test/auth/v1/.well-known/jwks.json',
        }), { status: 200 }));
      }
      return Promise.resolve(new Response('error', { status: 500 }));
    }) as unknown as typeof fetch;

    const { checkRuntimeHealth } = await import('../runtime/index.js');
    const health = await checkRuntimeHealth();

    expect(health.discovery).toBe(true);
    expect(health.jwks).toBe(false);
    expect(health.authorize).toBe(true);
    expect(health.token).toBe(true);
    expect(health.userinfo).toBe(true);
  });
});

describe('getDiscovery', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    setupConfig();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns discovery document on 200', async () => {
    const doc = { issuer: 'http://test', authorization_endpoint: 'http://test/auth' };
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(doc), { status: 200 }))
    ) as unknown as typeof fetch;

    const { getDiscovery } = await import('../runtime/index.js');
    const result = await getDiscovery();
    expect(result.issuer).toBe('http://test');
  });

  it('injects end_session_endpoint when GoTrue discovery does not provide one', async () => {
    // GoTrue 不提供 end_session_endpoint，SupaOAuth 需要补上
    const doc = {
      issuer: 'http://runtime.test/auth/v1',
      authorization_endpoint: 'http://runtime.test/auth/v1/authorize',
      token_endpoint: 'http://runtime.test/auth/v1/token',
    };
    globalThis.fetch = mock((_input: string | URL | Request) => {
      const url = typeof _input === 'string' ? _input : _input instanceof URL ? _input.toString() : _input.url;
      if (url.includes('/.well-known/openid-configuration')) {
        return Promise.resolve(new Response(JSON.stringify(doc), { status: 200 }));
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    }) as unknown as typeof fetch;

    const { getDiscovery } = await import('../runtime/index.js');
    const result = await getDiscovery();
    expect(result.end_session_endpoint).toBeTruthy();
    expect(typeof result.end_session_endpoint).toBe('string');
    // 应该指向 GoTrue 的 /logout 端点
    expect((result.end_session_endpoint as string)).toContain('/logout');
  });

  it('replaces a runtime end_session_endpoint with the public hosted endpoint', async () => {
    const originalEndpoint = 'http://runtime.test/auth/v1/session/end';
    const doc = {
      issuer: 'http://runtime.test/auth/v1',
      authorization_endpoint: 'http://runtime.test/auth/v1/authorize',
      token_endpoint: 'http://runtime.test/auth/v1/token',
      end_session_endpoint: originalEndpoint,
    };
    globalThis.fetch = mock((_input: string | URL | Request) => {
      const url = typeof _input === 'string' ? _input : _input instanceof URL ? _input.toString() : _input.url;
      if (url.includes('/.well-known/openid-configuration')) {
        return Promise.resolve(new Response(JSON.stringify(doc), { status: 200 }));
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    }) as unknown as typeof fetch;

    const { getDiscovery } = await import('../runtime/index.js');
    const result = await getDiscovery();
    expect(result.end_session_endpoint).toBe('http://auth.test/logout');
  });

  it('throws on non-2xx response', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('error', { status: 500 }))
    ) as unknown as typeof fetch;

    const { getDiscovery } = await import('../runtime/index.js');
    expect(getDiscovery()).rejects.toThrow('Discovery fetch failed');
  });
});

describe('getJWKS', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    setupConfig();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns JWKS document on 200', async () => {
    const jwks = { keys: [{ kty: 'EC' }] };
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(jwks), { status: 200 }))
    ) as unknown as typeof fetch;

    const { getJWKS } = await import('../runtime/index.js');
    const result = await getJWKS();
    expect(result.keys).toHaveLength(1);
  });

  it('throws on non-2xx response', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('error', { status: 503 }))
    ) as unknown as typeof fetch;

    const { getJWKS } = await import('../runtime/index.js');
    expect(getJWKS()).rejects.toThrow('JWKS fetch failed');
  });
});

describe('public admin SSO config', () => {
  beforeEach(() => {
    setupConfig();
    process.env.SUPAUTH_PUBLIC_URL = 'https://auth.example.test';
    process.env.OAUTH_RUNTIME_URL = 'https://auth.example.test';
    process.env.ADMIN_SSO_ISSUER = 'https://auth.example.test/auth/v1/';
    process.env.ADMIN_SSO_CLIENT_ID = 'supaoauth-admin-console';
    delete process.env.ADMIN_SSO_REDIRECT_URI;
    delete process.env.ADMIN_SSO_POST_LOGOUT_REDIRECT_URI;
    delete process.env.ADMIN_SSO_AUDIENCE;
    delete process.env.ADMIN_SSO_REQUIRE_AAL2;
    delete process.env.ADMIN_SSO_ALLOWED_EMAILS;
    delete process.env.ADMIN_SSO_ALLOWED_DOMAINS;
    delete process.env.ADMIN_TOKEN;
    loadConfig();
  });

  it('exposes only public browser SSO metadata for the Admin SPA', async () => {
    const { resolvePublicAdminSsoConfig } = await import('../routes/health.js');
    const config = resolvePublicAdminSsoConfig();

    expect(config).toEqual({
      enabled: true,
      issuer: 'https://auth.example.test/auth/v1',
      client_id: 'supaoauth-admin-console',
      redirect_uri: 'https://auth.example.test/admin',
      post_logout_redirect_uri: 'https://auth.example.test/admin/login',
      end_session_endpoint: 'https://auth.example.test/logout',
    });
    expect(Object.keys(config)).not.toContain('audience');
    expect(Object.keys(config)).not.toContain('allowed_emails');
    expect(Object.keys(config)).not.toContain('allowed_domains');
    expect(Object.keys(config)).not.toContain('require_aal2');
    expect(Object.keys(config)).not.toContain('token');
  });

  it('reports disabled when server-side admin SSO is incomplete', async () => {
    delete process.env.ADMIN_SSO_CLIENT_ID;
    const { resolvePublicAdminSsoConfig } = await import('../routes/health.js');
    const config = resolvePublicAdminSsoConfig();

    expect(config.enabled).toBe(false);
    expect(config.issuer).toBe('https://auth.example.test/auth/v1');
    expect(config.client_id).toBe('');
  });
});

describe('runtime OAuth server status', () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];

  beforeEach(() => {
    setupConfig();
    process.env.PROJECT_REF = 'business-project';
    process.env.SUPAUTH_OAUTH_AUTHORIZATION_PROJECT_REF = 'central-auth-project';
    loadConfig();
    calls.length = 0;
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, method: init?.method || 'GET' });
      return Promise.resolve(Response.json({ enabled: true, project_ref: 'central-auth-project' }));
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('reads OAuth server status from the configured authorization project', async () => {
    const { runtimeRoutes } = await import('../routes/health.js');
    const app = new Elysia().use(runtimeRoutes);

    const response = await app.handle(new Request('http://supauth.local/v1/runtime/oauth-server'));
    const payload = await response.json() as { enabled: boolean; project_ref: string };

    expect(response.status).toBe(200);
    expect(payload).toEqual({ enabled: true, project_ref: 'central-auth-project' });
    expect(calls.map((call) => [call.method, new URL(call.url).pathname])).toEqual([
      ['GET', '/v1/projects/central-auth-project/auth/oauth-server'],
    ]);
    expect(calls[0]?.url).not.toContain('/v1/projects/business-project/');
  });
});
