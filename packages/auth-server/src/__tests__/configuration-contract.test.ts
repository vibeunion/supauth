import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  configurationEndpoints, serverConfigurationContracts, type ConfigurationEndpointName,
} from '../../../shared/src/server-configuration.js';
import { decodeSchema } from '../../../shared/src/schema.js';
import {
  configurationContract, decodeConfigurationInput, decodeTenantConfiguration,
} from '../utils/configuration-contract.js';
import { validateServerResponse } from '../utils/server-contract.js';

const provider = { id: 'google', enabled: false, name: 'Google', type: 'social' };
const factory = { id: 'factory', name: 'OIDC', protocol: 'oidc', category: 'enterprise_sso', enabled: true };
const sso = { id: 'sso', connectorId: 'connector', domains: ['example.test'], ssoProtocol: 'oidc', jitProvisioning: true };
const experience = {
  branding: { logo_url: null, description: null, content: ['configured copy'] },
  sign_in_methods: ['password'], sign_up_enabled: true,
  password_policy: { min_length: 8, require_uppercase: false, require_lowercase: false, require_numbers: false, require_symbols: false },
};
const auth = {
  enable_signup: true, enable_confirmations: true, external_anonymous_users_enabled: false,
  jwt_expiry: 3600, password_min_length: 8, mfa_max_enrolled_factors: 10,
};
const security = {
  id: 'security', adminAuthMode: 'sso', adminAllowedEmails: ['admin@example.test'], adminAllowedDomains: [],
  rateLimitRpm: 300, rateLimitBurst: 50, bruteForceProtection: true, maxLoginAttempts: 10,
  lockoutDurationSec: 900, secretRotationReminderDays: 90, enforceHttps: true,
};
const tenant = {
  id: 'configuration', configType: 'account_center', key: 'default', enabled: true,
  value: { profile: { edit_mode: 'editable', fields: ['name'] }, security: { mfa: true } },
};
const page = (item: unknown) => ({ items: [item], total: 1, page: 1, limit: 50 });
const connectorParams = { connectorId: 'google' };
const tenantParams = { type: 'account_center', key: 'default' };
const authorizationParams = { authorizationId: 'authorization' };
const headers = { authorization: 'Bearer test-token' };

const fixtures = {
  listConnectors: { input: {}, result: page(provider) },
  getConnector: { input: { params: connectorParams }, result: provider },
  updateConnector: { input: { params: connectorParams, body: { enabled: false } }, result: provider },
  testConnector: { input: { params: connectorParams }, result: {
    runtime_kind: 'builtin_oauth', status: 'reachable', check_kind: 'runtime_configuration', authorization_url: 'https://login.example.test',
  } },
  getConnectorAuthorizationUri: { input: { params: connectorParams, query: { scope: 'openid' } }, result: {
    connector_id: 'google', authorization_uri: 'https://login.example.test',
  } },
  listConnectorFactories: { input: { query: { category: 'enterprise_sso' } }, result: page(factory) },
  upsertConnectorFactory: { input: { params: { factoryId: 'oidc' }, body: factory }, result: factory },
  createConnectorFromFactory: {
    input: { params: { factoryId: 'oidc' }, body: { name: 'OIDC', identifier: 'custom:one', client_id: 'client', client_secret: 'test-only', issuer: 'https://id.example.test' } },
    result: { id: 'runtime', connector_record_id: 'connector', provider_id: 'custom:one', name: 'OIDC', category: 'enterprise_sso', runtime_kind: 'custom_oidc', enabled: true },
  },
  listEnterpriseSSOConfigs: { input: {}, result: page(sso) },
  createEnterpriseSSOConfig: { input: { body: { connector_id: 'connector', domains: ['example.test'] } }, result: sso },
  getEnterpriseSSOConfig: { input: { params: { id: 'sso' } }, result: sso },
  updateEnterpriseSSOConfig: { input: { params: { id: 'sso' }, body: { domains: ['example.test'] } }, result: sso },
  deleteEnterpriseSSOConfig: { input: { params: { id: 'sso' } }, result: undefined },
  discoverEnterpriseSSO: { input: { params: { domain: 'example.test' } }, result: sso },
  getSignInExperience: { input: {}, result: experience },
  resolveSignInExperience: { input: { query: { application_id: 'client' } }, result: experience },
  updateSignInExperience: { input: { body: { branding: { logo_url: null }, password_policy: { min_length: 12 } } }, result: experience },
  getCustomUiStatus: { input: {}, result: {
    status: 'disabled', configured: false, enabled: false, lifecycle_state: null, assets_id: null,
    content_sha256: null, uploaded_at: null, file_count: 0, files: [], cleanup_pending: false, audit_pending: false,
  } },
  deleteCustomUiAssets: { input: {}, result: { status: 'deleted', deleted_file_count: 0 } },
  uploadCustomUiAssets: { input: {}, result: { success: false, error: { code: 'capability_unavailable', message: 'Custom UI upload requires a dedicated isolated origin.' } }, status: 501 },
  resolvePublicSignInExperience: { input: { query: {} }, result: { ...experience, connectors: [provider] } },
  authorizePublicConnector: { input: { params: connectorParams, query: { state: 'one' } }, result: { redirect: 'https://login.example.test' }, status: 302 },
  getPublicPhrases: { input: { params: { languageTag: 'en' } }, result: { language_tag: 'en', phrases: { welcome: 'Welcome' } } },
  getPublicCustomUi: { input: { params: { '*': 'index.html' } }, result: { error: 'not_found' }, status: 404 },
  getOAuthAuthorization: { input: { params: authorizationParams, headers }, result: { client: { id: 'client' }, user: { id: 'user' }, scope: 'openid' } },
  submitOAuthConsent: { input: { params: authorizationParams, headers, body: { action: 'approve' } }, result: { redirect_url: 'https://client.example.test/callback?code=one' } },
  getAuthConfig: { input: {}, result: auth },
  updateAuthConfig: { input: { body: { enable_signup: false } }, result: auth },
  getAuthConfigRuntimeConsistency: { input: {}, result: {
    checked_at: '2026-09-09T00:00:00Z', consistent: true,
    desired: { signups_enabled: true, enable_signup: true, disable_signup: null },
    runtime: { signups_enabled: true, disable_signup: false },
  } },
  listTenantConfigs: { input: { query: { type: 'account_center' } }, result: page(tenant) },
  getTenantConfig: { input: { params: tenantParams }, result: tenant },
  upsertTenantConfig: { input: { params: tenantParams, body: { value: tenant.value } }, result: tenant },
  deleteTenantConfig: { input: { params: tenantParams }, result: tenant },
  checkTenantDomain: { input: { params: { domain: 'login.example.test' } }, result: {
    domain: 'login.example.test', status: 'unknown', checked_at: '2026-09-09T00:00:00Z', error: 'unavailable',
  } },
  getSecurityConfig: { input: {}, result: security },
  updateSecurityConfig: { input: { body: { rateLimitRpm: 100 } }, result: security },
  getSecurityStatus: { input: {}, result: {
    admin_auth_mode: 'sso', token_auth_allowed: false, rate_limit_rpm: 300,
    brute_force_protection: true, enforce_https: true, warning_codes: [], warnings: [],
  } },
} satisfies Record<ConfigurationEndpointName, { input: unknown; result: unknown; status?: number }>;

function routeContract(name: ConfigurationEndpointName) {
  const endpoint = configurationEndpoints[name];
  const entry = serverConfigurationContracts[`${endpoint.method} ${endpoint.path}`];
  if (!entry) throw new Error(`Missing ${name}`);
  return entry.contract;
}

describe('configuration route contracts', () => {
  test('inventories all 37 owned operations, including the hidden retired route', () => {
    expect(Object.keys(configurationEndpoints).sort()).toEqual(Object.keys(fixtures).sort());
    expect(Object.keys(serverConfigurationContracts)).toHaveLength(37);
    expect(routeContract('getPublicCustomUi').hidden).toBe(true);
    expect(routeContract('getPublicCustomUi').retired).toBe(true);
  });

  for (const name of Object.keys(fixtures) as ConfigurationEndpointName[]) {
    test(`${name} validates complete input and native response, rejects invalid response`, async () => {
      const fixture = fixtures[name];
      expect(decodeConfigurationInput(name, fixture.input)).toEqual(fixture.input);
      const status = 'status' in fixture ? fixture.status : 200;
      const response = fixture.result === undefined ? new Response(null) : Response.json(fixture.result, {
        status, ...(name === 'authorizePublicConnector' ? { headers: { location: 'https://login.example.test' } } : {}),
      });
      await validateServerResponse(routeContract(name), response);
      await expect(validateServerResponse(routeContract(name), Response.json(['invalid'], { status }))).rejects.toMatchObject({
        code: 'invalid_upstream_response',
      });
    });
  }

  test('rejects nested errors in each configuration family', () => {
    const invalid: Array<[ConfigurationEndpointName, unknown]> = [
      ['getConnector', { ...provider, enabled: 'true' }],
      ['listConnectorFactories', page({ ...factory, enabled: 'true' })],
      ['getEnterpriseSSOConfig', { ...sso, domains: [1] }],
      ['getSignInExperience', { ...experience, password_policy: { ...experience.password_policy, min_length: '8' } }],
      ['getSecurityConfig', { ...security, rateLimitRpm: '300' }],
      ['getTenantConfig', { ...tenant, value: { security: { mfa: 'true' } } }],
      ['getOAuthAuthorization', { client: { id: 'client' }, user: { id: false }, scope: 'openid' }],
      ['getAuthConfig', { ...auth, jwt_expiry: '3600' }],
    ];
    for (const [name, result] of invalid) {
      expect(() => decodeSchema(configurationEndpoints[name].result, result)).toThrow();
    }
  });

  test('rejects undefined optional members, malformed known values and mismatched tenant domains', () => {
    expect(() => decodeConfigurationInput('updateSecurityConfig', { body: { enforceHttps: undefined } })).toThrow();
    expect(() => decodeConfigurationInput('updateSecurityConfig', { body: { rateLimitRpm: 0 } })).toThrow();
    expect(() => decodeConfigurationInput('upsertTenantConfig', {
      params: { type: 'phrase', key: 'en' }, body: { value: { welcome: 1 } },
    })).toThrow();
    expect(() => decodeTenantConfiguration('account_center', { profile: { fields: [42] } })).toThrow();
    expect(() => decodeTenantConfiguration('captcha', { secret: new Date() })).toThrow();
  });

  test('checks native media and keeps the original readable response intact', async () => {
    const response = Response.json(auth, { headers: { 'x-preserved': 'yes' } });
    await validateServerResponse(routeContract('getAuthConfig'), response);
    expect(await response.json()).toEqual(auth);
    expect(response.headers.get('x-preserved')).toBe('yes');
    await expect(validateServerResponse(routeContract('getAuthConfig'), new Response(JSON.stringify(auth), {
      headers: { 'content-type': 'text/html' },
    }))).rejects.toThrow();
    await validateServerResponse(routeContract('getSecurityConfig'), new Response('Security config not found. Run migration first.', { status: 404 }));
    await expect(validateServerResponse(routeContract('getSecurityConfig'), new Response('arbitrary failure', { status: 404 }))).rejects.toThrow();
  });

  test('preserves empty reads when no global sign-in configuration row exists', async () => {
    for (const name of ['getSignInExperience', 'resolveSignInExperience'] as const) {
      await validateServerResponse(routeContract(name), null);
      await validateServerResponse(routeContract(name), new Response(null));
      await expect(validateServerResponse(routeContract(name), { branding: false })).rejects.toThrow();
    }
  });

  test('executes the handler decoder and output hook without preempting authentication', async () => {
    let mutations = 0;
    const app = new Elysia()
      .onBeforeHandle(({ request }) => request.headers.has('authorization') ? undefined : new Response('Unauthorized', { status: 401 }))
      .put('/security', ({ body }) => {
        decodeConfigurationInput('updateSecurityConfig', { body });
        mutations++;
        return Response.json(security);
      }, configurationContract('updateSecurityConfig', { detail: { summary: 'Security' } }));
    const request = (body: unknown, authorized = true) => new Request('http://localhost/security', {
      method: 'PUT', headers: { 'content-type': 'application/json', ...(authorized ? { authorization: 'Bearer test' } : {}) },
      body: JSON.stringify(body),
    });
    expect((await app.handle(request({ enforceHttps: 'no' }, false))).status).toBe(401);
    expect((await app.handle(request({ enforceHttps: 'no' }))).status).toBe(400);
    expect(mutations).toBe(0);
    expect((await app.handle(request({ enforceHttps: true }))).status).toBe(200);
    expect(mutations).toBe(1);
  });

  test('checks Location against the 302 JSON body for native and framework responses', async () => {
    const hook = configurationContract('authorizePublicConnector', {}).afterHandle;
    await hook({ responseValue: { redirect: 'https://id.example.test' }, set: {
      status: 302, headers: { location: 'https://id.example.test' },
    } });
    await expect(hook({ responseValue: { redirect: 'https://id.example.test' }, set: {
      status: 302, headers: { location: 'https://other.example.test' },
    } })).rejects.toMatchObject({ code: 'invalid_upstream_response' });
    await expect(hook({ responseValue: Response.json({ redirect: 'https://id.example.test' }, {
      status: 302, headers: { location: 'https://other.example.test' },
    }), set: {} })).rejects.toMatchObject({ code: 'invalid_upstream_response' });
  });
});
