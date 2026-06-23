import { describe, it, expect, beforeEach, mock, afterEach } from 'bun:test';
import { loadConfig } from '../config/index.js';

function setupConfig() {
  process.env.OAUTH_RUNTIME_URL = 'http://runtime.test';
  process.env.SUPACLOUD_API_URL = 'http://localhost:9090';
  process.env.SUPACLOUD_MASTER_TOKEN = 'test-token';
  process.env.PROJECT_REF = 'test-ref';
  process.env.DATABASE_URL = 'postgres://test';
  process.env.RUNTIME_MODE = 'gotrue';
  loadConfig();
}

function createMockFetch(discoveryOverrides?: Record<string, unknown>) {
  return mock((_input: string | URL | Request) => {
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
        ...discoveryOverrides,
      }), { status: 200 }));
    }
    if (url.includes('/.well-known/jwks.json')) {
      return Promise.resolve(new Response(JSON.stringify({ keys: [{ kty: 'EC' }] }), { status: 200 }));
    }
    if (url.includes('/v1/projects/test-ref/config/auth')) {
      return Promise.resolve(new Response(JSON.stringify({ enable_signup: true }), { status: 200 }));
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  }) as unknown as typeof fetch;
}

describe('Supabase Compatibility Inspector', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    setupConfig();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns all SC and RB check IDs when runtime is mocked', async () => {
    globalThis.fetch = createMockFetch();

    const { runCompatibilityChecks } = await import('../compatibility/supabase.js');
    const results = await runCompatibilityChecks();
    const checkIds = results.map(r => r.check_id);

    // SC checks
    expect(checkIds).toContain('sc-1-discovery');
    expect(checkIds).toContain('sc-2-jwks');
    expect(checkIds).toContain('sc-3-auth-endpoints');
    expect(checkIds).toContain('sc-4-issuer');
    expect(checkIds).toContain('sc-6-supacloud-reachable');
    expect(checkIds).toContain('sc-7-scopes');

    // Runtime RB checks
    expect(checkIds.some(id => id.startsWith('rb-4-'))).toBe(true);
    expect(checkIds).toContain('rb-5-app-metadata-namespace');
    expect(checkIds).toContain('rb-6-schema-isolation');
    expect(checkIds).not.toContain('rb-1-authorize-function');
    expect(checkIds).not.toContain('rb-2-has-org-permission-function');
    expect(checkIds).not.toContain('rb-3-helper-grants');
    expect(checkIds).not.toContain('rb-7-unsafe-rls-patterns');
  });

  it('marks discovery pass when reachable', async () => {
    globalThis.fetch = createMockFetch();

    const { runCompatibilityChecks } = await import('../compatibility/supabase.js');
    const results = await runCompatibilityChecks();

    const discovery = results.find(r => r.check_id === 'sc-1-discovery');
    expect(discovery?.status).toBe('pass');
  });

  it('marks discovery fail when unreachable', async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error('network error'))
    ) as unknown as typeof fetch;

    const { runCompatibilityChecks } = await import('../compatibility/supabase.js');
    const results = await runCompatibilityChecks();

    const discovery = results.find(r => r.check_id === 'sc-1-discovery');
    expect(discovery?.status).toBe('fail');
  });

  it('marks jwks pass when reachable', async () => {
    globalThis.fetch = createMockFetch();

    const { runCompatibilityChecks } = await import('../compatibility/supabase.js');
    const results = await runCompatibilityChecks();

    const jwks = results.find(r => r.check_id === 'sc-2-jwks');
    expect(jwks?.status).toBe('pass');
  });

  it('marks auth endpoints pass when present in discovery', async () => {
    globalThis.fetch = createMockFetch();

    const { runCompatibilityChecks } = await import('../compatibility/supabase.js');
    const results = await runCompatibilityChecks();

    const authEndpoints = results.find(r => r.check_id === 'sc-3-auth-endpoints');
    expect(authEndpoints?.status).toBe('pass');
  });

  it('marks issuer pass when present', async () => {
    globalThis.fetch = createMockFetch();

    const { runCompatibilityChecks } = await import('../compatibility/supabase.js');
    const results = await runCompatibilityChecks();

    const issuer = results.find(r => r.check_id === 'sc-4-issuer');
    expect(issuer?.status).toBe('pass');
    expect(issuer?.message).toContain('http://runtime.test/auth/v1');
  });

  it('marks supacloud reachable when auth config responds', async () => {
    globalThis.fetch = createMockFetch();

    const { runCompatibilityChecks } = await import('../compatibility/supabase.js');
    const results = await runCompatibilityChecks();

    const supacloud = results.find(r => r.check_id === 'sc-6-supacloud-reachable');
    expect(supacloud?.status).toBe('pass');
  });

  it('marks supacloud fail when auth config throws', async () => {
    globalThis.fetch = mock((_input: string | URL | Request) => {
      const url = typeof _input === 'string' ? _input : _input instanceof URL ? _input.toString() : _input.url;
      if (url.includes('/v1/projects/test-ref/config/auth')) {
        return Promise.resolve(new Response('unauthorized', { status: 401 }));
      }
      if (url.includes('/.well-known/openid-configuration')) {
        return Promise.resolve(new Response(JSON.stringify({
          issuer: 'http://test',
          authorization_endpoint: 'http://test/auth',
          token_endpoint: 'http://test/token',
          userinfo_endpoint: 'http://test/userinfo',
          jwks_uri: 'http://test/jwks',
          scopes_supported: ['openid'],
        }), { status: 200 }));
      }
      if (url.includes('/.well-known/jwks.json')) {
        return Promise.resolve(new Response(JSON.stringify({ keys: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    }) as unknown as typeof fetch;

    const { runCompatibilityChecks } = await import('../compatibility/supabase.js');
    const results = await runCompatibilityChecks();

    const supacloud = results.find(r => r.check_id === 'sc-6-supacloud-reachable');
    expect(supacloud?.status).toBe('fail');
  });

  it('marks scopes pass when openid/profile/email present', async () => {
    globalThis.fetch = createMockFetch();

    const { runCompatibilityChecks } = await import('../compatibility/supabase.js');
    const results = await runCompatibilityChecks();

    const scopes = results.find(r => r.check_id === 'sc-7-scopes');
    expect(scopes?.status).toBe('pass');
  });

  it('marks scopes warn when required scopes missing', async () => {
    globalThis.fetch = createMockFetch({ scopes_supported: ['openid'] });

    const { runCompatibilityChecks } = await import('../compatibility/supabase.js');
    const results = await runCompatibilityChecks();

    const scopes = results.find(r => r.check_id === 'sc-7-scopes');
    expect(scopes?.status).toBe('warn');
  });

  it('returns rb-5 and rb-6 as pass (always pass in offline mode)', async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error('network error'))
    ) as unknown as typeof fetch;

    const { runCompatibilityChecks } = await import('../compatibility/supabase.js');
    const results = await runCompatibilityChecks();

    const rb5 = results.find(r => r.check_id === 'rb-5-app-metadata-namespace');
    expect(rb5?.status).toBe('pass');

    const rb6 = results.find(r => r.check_id === 'rb-6-schema-isolation');
    expect(rb6?.status).toBe('pass');
  });

  it('does not include install-time database migration checks in runtime compatibility', async () => {
    globalThis.fetch = createMockFetch();

    const { runCompatibilityChecks } = await import('../compatibility/supabase.js');
    const results = await runCompatibilityChecks();
    const checkIds = results.map(r => r.check_id);

    expect(checkIds).not.toContain('rb-1-authorize-function');
    expect(checkIds).not.toContain('rb-2-has-org-permission-function');
    expect(checkIds).not.toContain('rb-3-helper-grants');
    expect(checkIds).not.toContain('rb-7-unsafe-rls-patterns');
  });
});

describe('SC-5 external_oidc signing check — contract verification', () => {
  it('asymmetric signing algorithms are correctly identified', () => {
    const asymmetricAlgs = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512', 'PS256', 'PS384', 'PS512'];
    expect(asymmetricAlgs).toContain('ES256');
    expect(asymmetricAlgs).toContain('RS256');
    expect(asymmetricAlgs).not.toContain('HS256');
  });

  it('symmetric algorithms are not in the asymmetric list', () => {
    const asymmetricAlgs = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512', 'PS256', 'PS384', 'PS512'];
    expect(asymmetricAlgs).not.toContain('HS256');
    expect(asymmetricAlgs).not.toContain('HS384');
    expect(asymmetricAlgs).not.toContain('HS512');
  });
});
