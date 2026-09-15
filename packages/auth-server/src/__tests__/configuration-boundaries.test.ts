import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { serverConfigurationContracts } from '../../../shared/src/server-configuration.js';

process.env["SUPACLOUD_INTERNAL_API_URL"] = 'http://supacloud.internal';
process.env["SUPACLOUD_INTERNAL_TOKEN"] = 'test-token';
process.env["SUPAOAUTH_BFF_SIGNING_SECRET"] = 'test-bff-signing-secret-32-characters';
process.env["SUPACLOUD_PROJECT_REF"] = 'test-project';
process.env["SUPACLOUD_RUNTIME_URL"] = 'http://runtime.internal';
process.env["SUPACLOUD_DATABASE_URL"] = 'postgres://test';
process.env["ADMIN_AUTH_MODE"] = 'token';
process.env.NODE_ENV = 'test';

const authFixture = {
  enable_signup: true, disable_signup: false, enable_confirmations: true,
  external_anonymous_users_enabled: false, jwt_expiry: 3600, password_min_length: 8,
  mfa_max_enrolled_factors: 10, password_required_characters: '',
};
let authResponse: unknown = authFixture;
const getAuthConfig = mock(async () => authResponse);
const updateAuthConfig = mock(async (_input: unknown) => authResponse);
const logAudit = mock(async (_input: unknown) => ({}));
const recordOAuthConsentDecision = mock(async (_input: unknown) => ({}));
mock.module('../supacloud/adapter.js', () => ({
  SupaCloudApiError: class extends Error { status = 500; body = ''; path = ''; },
  getSupaCloudAdapter: () => ({ getAuthConfig, updateAuthConfig }),
  isSupaCloudApiError: () => false,
}));
mock.module('../repositories/audit.js', () => ({ logAudit }));
mock.module('../repositories/consents.js', () => ({ recordOAuthConsentDecision }));

const {
  authConfigRoutes, publicOAuthRoutes, publicCustomUiRoutes, sieRoutes, publicSignInExperienceRoutes,
  publicConnectorRoutes, publicPhrasesRoutes,
} = await import('../routes/sign-in-experience.js');
const { connectorRoutes } = await import('../routes/connectors.js');
const { enterpriseSSORoutes } = await import('../routes/enterprise-sso.js');
const { tenantConfigRoutes } = await import('../routes/tenant-config.js');
const { securityConfigRoutes } = await import('../routes/security-config.js');
const { observabilityMiddleware } = await import('../middleware/index.js');
const app = new Elysia().use(observabilityMiddleware)
  .use(authConfigRoutes).use(publicOAuthRoutes).use(publicCustomUiRoutes).use(sieRoutes)
  .use(publicSignInExperienceRoutes).use(publicConnectorRoutes).use(publicPhrasesRoutes)
  .use(connectorRoutes).use(enterpriseSSORoutes).use(tenantConfigRoutes).use(securityConfigRoutes);
const originalFetch = globalThis.fetch;

beforeEach(() => {
  authResponse = authFixture;
  getAuthConfig.mockClear();
  updateAuthConfig.mockClear();
  logAudit.mockClear();
  recordOAuthConsentDecision.mockClear();
  globalThis.fetch = originalFetch;
});
afterAll(() => { globalThis.fetch = originalFetch; });

function consentRequest(body: unknown, token = true) {
  return new Request('http://localhost/v1/public/oauth/authorizations/one/consent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer test-token' } : {}) },
    body: JSON.stringify(body),
  });
}

describe('configuration routes enforce real execution boundaries', () => {
  test('matches the complete actual C-group router inventory to the executable contract map', () => {
    const registered = app.routes.map(route => `${route.method} ${route.path.replace(/\/$/, '')}`).sort();
    expect(registered).toEqual(Object.keys(serverConfigurationContracts).sort());
    expect(registered).toHaveLength(37);
    for (const route of app.routes) {
      expect(route.hooks.detail?.['x-supauth-contract']).toBeDefined();
      expect(route.hooks.afterHandle?.length).toBeGreaterThan(0);
    }
  });
  test('reads a complete auth configuration and rejects incomplete or mistyped runtime responses', async () => {
    expect((await app.handle(new Request('http://localhost/v1/auth-config'))).status).toBe(200);
    for (const invalid of [{ password_min_length: 8 }, { ...authFixture, disable_signup: 'true' }]) {
      authResponse = invalid;
      const response = await app.handle(new Request('http://localhost/v1/auth-config'));
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ error: { code: 'invalid_upstream_response' } });
    }
  });

  test('preserves disable_signup serialization and executes one configuration write', async () => {
    authResponse = { ...authFixture, disable_signup: true };
    const response = await app.handle(new Request('http://localhost/v1/auth-config', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ disable_signup: true }),
    }));
    expect(response.status).toBe(200);
    expect(updateAuthConfig).toHaveBeenCalledTimes(1);
    expect(updateAuthConfig).toHaveBeenCalledWith({ disable_signup: true });
    expect(logAudit).toHaveBeenCalledTimes(1);
  });

  test('keeps bearer authentication before action validation without invoking GoTrue', async () => {
    const fetcher = mock(async () => Response.json({}));
    globalThis.fetch = Object.assign(fetcher, { preconnect: originalFetch.preconnect });
    const unauthorized = await app.handle(consentRequest({ action: 'invalid' }, false));
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: 'missing_bearer_token' });
    const invalid = await app.handle(consentRequest({ action: 'invalid' }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'validation_failed', message: "action must be 'approve' or 'deny'" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(recordOAuthConsentDecision).not.toHaveBeenCalled();
  });

  test('rejects malformed authorization details before submitting a consent decision', async () => {
    const fetcher = mock(async () => Response.json({
      client: { id: 'client' }, user: { id: 'user', email: false }, scope: 'openid',
    }));
    globalThis.fetch = Object.assign(fetcher, { preconnect: originalFetch.preconnect });
    const response = await app.handle(consentRequest({ action: 'approve' }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: 'invalid_upstream_response' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(recordOAuthConsentDecision).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  test('never replays a consent write and rejects malformed acknowledgment before local audit', async () => {
    const methods: string[] = [];
    const fetcher = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      methods.push(init?.method || 'GET');
      return init?.method === 'POST'
        ? Response.json({ redirect_url: false })
        : Response.json({ client: { id: 'client' }, user: { id: 'user' }, scope: 'openid' });
    });
    globalThis.fetch = Object.assign(fetcher, { preconnect: originalFetch.preconnect });
    const response = await app.handle(consentRequest({ action: 'approve' }));
    expect(response.status).toBe(502);
    expect(methods).toEqual(['GET', 'POST']);
    expect(recordOAuthConsentDecision).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  test('keeps the disabled Custom UI native response and cache control', async () => {
    const response = await app.handle(new Request('http://localhost/v1/public/custom-ui/index.html'));
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'not_found' });
  });
});
