import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { runRBACCompatibilityChecks } from '../compatibility/rbac.js';

describe('RBAC Compatibility Inspector', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    process.env.RUNTIME_MODE = 'gotrue';
    process.env.SUPACLOUD_API_URL = 'http://localhost:9090';
    process.env.SUPACLOUD_MASTER_TOKEN = 'test';
    process.env.PROJECT_REF = 'test';
    process.env.DATABASE_URL = 'postgres://test';
    process.env.OAUTH_RUNTIME_URL = 'http://runtime.test';

    originalFetch = globalThis.fetch;
    // Mock fetch so getDiscovery inside RB-4 doesn't hang
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
        }), { status: 200 }));
      }
      if (url.includes('/.well-known/jwks.json')) {
        return Promise.resolve(new Response(JSON.stringify({ keys: [{ kty: 'EC' }] }), { status: 200 }));
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns all expected RBAC check IDs', async () => {
    const results = await runRBACCompatibilityChecks();
    const checkIds = results.map(r => r.check_id);

    expect(checkIds.some(id => id.startsWith('rb-4-'))).toBe(true);
    expect(checkIds).toContain('rb-5-app-metadata-namespace');
    expect(checkIds).toContain('rb-6-schema-isolation');
    expect(checkIds).not.toContain('rb-1-authorize-function');
    expect(checkIds).not.toContain('rb-2-has-org-permission-function');
    expect(checkIds).not.toContain('rb-3-helper-grants');
    expect(checkIds).not.toContain('rb-7-unsafe-rls-patterns');
  });

  it('marks schema isolation as pass', async () => {
    const results = await runRBACCompatibilityChecks();
    const schemaCheck = results.find(r => r.check_id === 'rb-6-schema-isolation');
    expect(schemaCheck?.status).toBe('pass');
  });

  it('marks app metadata namespace as pass', async () => {
    const results = await runRBACCompatibilityChecks();
    const nsCheck = results.find(r => r.check_id === 'rb-5-app-metadata-namespace');
    expect(nsCheck?.status).toBe('pass');
  });

  it('returns rb-4-gotrue-jwt-role-safe in gotrue mode with reachable discovery', async () => {
    const results = await runRBACCompatibilityChecks();
    const rb4 = results.find(r => r.check_id === 'rb-4-gotrue-jwt-role-safe');
    expect(rb4).toBeDefined();
    expect(rb4?.status).toBe('pass');
    expect(rb4?.details?.runtime_mode).toBe('gotrue');
  });

  it('reports the ordered unique supported algorithms without claiming a current algorithm', async () => {
    globalThis.fetch = mock((_input: string | URL | Request) => {
      const url = typeof _input === 'string' ? _input : _input instanceof URL ? _input.toString() : _input.url;
      if (url.includes('/.well-known/openid-configuration')) {
        return Promise.resolve(Response.json({
          issuer: 'http://runtime.test/auth/v1',
          id_token_signing_alg_values_supported: [
            ' RS256 ',
            'HS256',
            'ES256',
            'RS256',
            '',
            null,
          ],
        }));
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    }) as unknown as typeof fetch;

    const results = await runRBACCompatibilityChecks();
    const rb4 = results.find(result => result.check_id === 'rb-4-gotrue-jwt-role-safe');

    expect(rb4?.status).toBe('pass');
    expect(rb4?.details?.signing_algs_supported).toEqual(['RS256', 'HS256', 'ES256']);
    expect(rb4?.details).not.toHaveProperty('signing_alg');
  });

  it('keeps install-time database checks out of runtime RBAC compatibility', async () => {
    const results = await runRBACCompatibilityChecks();
    const checkIds = results.map(r => r.check_id);

    expect(checkIds).not.toContain('rb-1-authorize-function');
    expect(checkIds).not.toContain('rb-2-has-org-permission-function');
    expect(checkIds).not.toContain('rb-3-helper-grants');
    expect(checkIds).not.toContain('rb-7-unsafe-rls-patterns');
  });
});
