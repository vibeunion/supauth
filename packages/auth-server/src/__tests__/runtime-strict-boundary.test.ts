import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import { loadConfig } from '../config/index.js';

process.env['OAUTH_RUNTIME_URL'] = 'https://runtime.invalid';
process.env['OAUTH_RUNTIME_INTERNAL_URL'] = 'https://internal.invalid';
process.env['SUPAUTH_PUBLIC_URL'] = 'https://auth.invalid';
const config = loadConfig();
const { checkRuntimeHealth, getDiscovery, getJWKS } = await import('../runtime/index.js');
const { runtimeRoutes } = await import('../routes/health.js');
const { observabilityMiddleware } = await import('../middleware/index.js');
const originalFetch = globalThis.fetch;

const discovery = {
  issuer: 'https://runtime.invalid/auth/v1',
  authorization_endpoint: 'https://runtime.invalid/auth/v1/authorize',
  token_endpoint: 'https://runtime.invalid/auth/v1/token',
  userinfo_endpoint: 'https://runtime.invalid/auth/v1/userinfo',
  jwks_uri: 'https://keys.invalid/jwks',
  id_token_signing_alg_values_supported: ['ES256'],
};
const jwks = { keys: [{ kty: 'EC', use: 'sig', alg: 'ES256' }] };

beforeEach(() => {
  config.oauthRuntimeUrl = 'https://runtime.invalid';
  config.oauthRuntimeInternalUrl = 'https://internal.invalid';
  config.publicBaseUrl = 'https://auth.invalid';
});
afterEach(() => { globalThis.fetch = originalFetch; });

function responses(discoveryValue: unknown, jwksValue: unknown): void {
  globalThis.fetch = Object.assign(async (target: string | URL | Request) => {
    const url = target instanceof Request ? target.url : String(target);
    return Response.json(url.includes('openid-configuration') ? discoveryValue : jwksValue);
  }, { preconnect() {} });
}

function request(path: 'health' | 'discovery' | 'jwks'): Promise<Response> {
  return new Elysia().use(observabilityMiddleware).use(runtimeRoutes)
    .handle(new Request(`https://auth.invalid/v1/runtime/${path}`));
}

describe('actual runtime protocol boundaries', () => {
  it('does not admit arbitrary objects or malformed keys as healthy runtime metadata', async () => {
    responses({ keys: 42 }, { keys: 42 });
    await expect(getJWKS()).rejects.toMatchObject({ status: 502, code: 'invalid_upstream_response' });
    await expect(getDiscovery()).rejects.toMatchObject({ status: 502, code: 'invalid_upstream_response' });
    expect(await checkRuntimeHealth()).toEqual({
      discovery: false, jwks: false, authorize: false, token: false, userinfo: false,
      issuer: null, signing_alg: null,
    });
    expect((await request('discovery')).status).toBe(502);
    expect((await request('jwks')).status).toBe(502);
    const health = await request('health');
    expect(health.status).toBe(200);
    const body: unknown = await health.json();
    expect(body).toMatchObject({ discovery: false, jwks: false });
  });

  it('requires the shared discovery endpoints and rejects non-HTTP or malformed endpoint fields', async () => {
    for (const invalid of [
      {}, { issuer: discovery.issuer }, { ...discovery, issuer: '' },
      { ...discovery, issuer: 'https://runtime.invalid/?private=value' },
      { ...discovery, jwks_uri: 42 }, { ...discovery, token_endpoint: 'not-a-url' },
      { ...discovery, authorization_endpoint: 'javascript:invalid' },
      { ...discovery, userinfo_endpoint: null },
      { ...discovery, id_token_signing_alg_values_supported: [42] },
    ]) {
      responses(invalid, jwks);
      await expect(getDiscovery()).rejects.toMatchObject({ code: 'invalid_upstream_response' });
      expect(await checkRuntimeHealth()).toMatchObject({ discovery: false, jwks: false });
      expect((await request('discovery')).status).toBe(502);
    }
  });

  it('validates JWKS keys and their metadata before granting JWKS health', async () => {
    for (const invalid of [
      {}, null, [], { keys: null }, { keys: 42 }, { keys: [null] }, { keys: [{}] },
      { keys: [{ kty: '' }] }, { keys: [{ kty: ' ' }] }, { keys: [{ kty: 1 }] },
      { keys: [{ kty: 'EC', alg: 42 }] }, { keys: [{ kty: 'RSA', key_ops: [1] }] },
    ]) {
      responses(discovery, invalid);
      await expect(getJWKS()).rejects.toMatchObject({ code: 'invalid_upstream_response' });
      expect(await checkRuntimeHealth()).toMatchObject({ discovery: true, jwks: false });
      expect((await request('jwks')).status).toBe(502);
    }
  });

  it('preserves valid typed discovery, signing metadata, and empty JWKS documents', async () => {
    responses(discovery, jwks);
    expect(await getJWKS()).toEqual(jwks);
    expect(await getDiscovery()).toMatchObject({ ...discovery, end_session_endpoint: 'https://auth.invalid/logout' });
    expect(await checkRuntimeHealth()).toMatchObject({
      discovery: true, jwks: true, authorize: true, token: true, userinfo: true, signing_alg: 'ES256',
    });
    expect((await request('discovery')).status).toBe(200);
    expect((await request('jwks')).status).toBe(200);
    responses(discovery, { keys: [] });
    expect(await getJWKS()).toEqual({ keys: [] });
  });

  it('keeps read fallback when an internal candidate returns an invalid document', async () => {
    const urls: string[] = [];
    globalThis.fetch = Object.assign(async (target: string | URL | Request) => {
      const url = target instanceof Request ? target.url : String(target);
      urls.push(url);
      return Response.json(url.startsWith('https://internal.invalid/')
        ? { keys: 42 } : url.includes('openid-configuration') ? discovery : jwks);
    }, { preconnect() {} });
    expect(await getDiscovery()).toMatchObject(discovery);
    expect(await getJWKS()).toEqual(jwks);
    expect(urls).toContain('https://internal.invalid/.well-known/openid-configuration');
    expect(urls).toContain('https://runtime.invalid/.well-known/openid-configuration');
    expect(urls).toContain('https://runtime.invalid/.well-known/jwks.json');
  });

  it('validates the discovery-advertised JWKS URI after a direct JWKS failure', async () => {
    globalThis.fetch = Object.assign(async (target: string | URL | Request) => {
      const url = target instanceof Request ? target.url : String(target);
      return Response.json(url.includes('openid-configuration') ? discovery : url === discovery.jwks_uri ? jwks : { keys: 42 });
    }, { preconnect() {} });
    expect(await checkRuntimeHealth()).toMatchObject({ discovery: true, jwks: true, signing_alg: 'ES256' });
  });

  it('rejects malformed successful JSON through the actual runtime APIs', async () => {
    globalThis.fetch = Object.assign(async () => new Response('{', {
      headers: { 'Content-Type': 'application/json' },
    }), { preconnect() {} });
    expect((await request('discovery')).status).toBe(502);
    expect((await request('jwks')).status).toBe(502);
    expect(await checkRuntimeHealth()).toMatchObject({ discovery: false, jwks: false });
  });
});
