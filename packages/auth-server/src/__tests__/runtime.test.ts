import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';

function setupConfig() {
  process.env.OAUTH_RUNTIME_URL = 'http://runtime.test';
  process.env.SUPACLOUD_API_URL = 'http://localhost:9090';
  process.env.SUPACLOUD_MASTER_TOKEN = 'test-token';
  process.env.PROJECT_REF = 'test-ref';
  process.env.DATABASE_URL = 'postgres://test';
  process.env.RUNTIME_MODE = 'gotrue';
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
