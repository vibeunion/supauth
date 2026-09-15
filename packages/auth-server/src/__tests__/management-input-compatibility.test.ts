import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { ApiContractError } from '../utils/api-contract.js';
import { decodeSchema } from '../../../shared/src/schema.js';
import { sdkEndpoints } from '../../../shared/src/sdk-endpoints.js';

const time = '2026-09-08T00:00:00Z';
const member = {
  id: 'member-one', project_ref: 'project-one', principal_id: 'principal-one',
  email: 'admin@example.test', role: 'admin', status: 'active', scope: 'project',
  capabilities: ['tenant.members.read'], created_at: time, updated_at: time,
};
const invitation = {
  id: 'invite-one', project_ref: 'project-one', email: 'admin@example.test',
  role: 'admin', status: 'pending', scope: 'project',
  expires_at: time, created_at: time, updated_at: time,
};
const resource = {
  id: 'resource-one', name: 'Documents', indicator: 'https://api.example.test',
  description: null, createdAt: time, updatedAt: time,
};
const writes: Array<{ operation: string; input: unknown }> = [];
const audits: unknown[] = [];
const runtime = { security_captcha_enabled: false, security_captcha_provider: 'none' };
const scope = { id: 'scope-one', resourceId: resource.id, name: 'read', description: null };
const experience = {
  branding: {}, sign_in_methods: ['password'], sign_up_enabled: true,
  password_policy: {
    min_length: 8, require_uppercase: false, require_lowercase: false,
    require_numbers: false, require_symbols: false,
  },
};
const connectorId = '00000000-0000-4000-8000-000000000001';
let providerReads = 0;

mock.module('../config/index.js', () => ({ getConfig: () => ({ nodeEnv: 'test' }) }));
mock.module('../supacloud/adapter.js', () => {
  const adapter = {
    createOAuthClient: async (input: unknown) => {
      writes.push({ operation: 'createApplication', input });
      return { client_id: 'app-one' };
    },
    updateOAuthClient: async (_id: string, input: unknown) => {
      writes.push({ operation: 'updateApplication', input });
      return { client_id: 'app-one' };
    },
    getOAuthClient: async (id: string) => ({ client_id: id }),
    updateTenantMember: async (_id: string, input: unknown) => {
      writes.push({ operation: 'updateTenantMember', input });
      return member;
    },
    createTenantInvitation: async (input: unknown) => {
      writes.push({ operation: 'createTenantInvitation', input });
      return invitation;
    },
    updateAuthConfig: async (input: unknown) => {
      writes.push({ operation: 'captcha', input });
      return runtime;
    },
    getAuthConfig: async () => runtime,
    getCustomOidcProvider: async () => { providerReads++; return { identifier: 'custom:one' }; },
  };
  return {
    getSupaCloudAdapter: () => adapter, getSupaCloudAdapterForProject: () => adapter,
    isSupaCloudApiError: () => false,
  };
});
mock.module('../repositories/audit.js', () => ({
  logAudit: async (input: unknown) => { audits.push(input); },
}));
mock.module('../repositories/webhook-delivery.js', () => ({
  buildEvent: (event: string, input: unknown) => ({ event, input }),
  dispatchEvent: async () => {},
}));
mock.module('../repositories/application-control.js', () => ({
  upsertApplicationConsentSettings: async (applicationId: string, input: {
    userScopes?: string[]; organizationScopes?: string[]; allowedOrganizationIds?: string[];
    requireExplicitConsent?: boolean; customData?: Record<string, unknown>;
  }) => {
    writes.push({ operation: 'consent', input });
    return {
      applicationId, userScopes: input.userScopes ?? [], organizationScopes: input.organizationScopes ?? [],
      allowedOrganizationIds: input.allowedOrganizationIds ?? [],
      requireExplicitConsent: input.requireExplicitConsent ?? true, customData: input.customData ?? {},
    };
  },
}));
mock.module('../repositories/resources.js', () => ({
  getResource: async () => ({ ...resource, scopes: [scope] }),
  createResource: async (input: unknown) => {
    writes.push({ operation: 'createResource', input });
    return { ...resource, scopes: [scope] };
  },
  addScope: async (_id: string, input: unknown) => {
    writes.push({ operation: 'addScope', input });
    return scope;
  },
  updateScope: async (_id: string, input: unknown) => {
    writes.push({ operation: 'updateScope', input });
    return scope;
  },
  updateResource: async (_id: string, input: unknown) => {
    writes.push({ operation: 'updateResource', input });
    return resource;
  },
}));
mock.module('../repositories/tenant-config.js', () => ({
  upsertConnectorFactory: async (factoryId: string, input: {
    name: string; protocol: string; category: string; configSchema?: Record<string, unknown>; enabled?: boolean;
  }) => {
    writes.push({ operation: 'factory', input });
    return { id: 'factory-one', factoryId, ...input, configSchema: input.configSchema || {}, enabled: input.enabled ?? true };
  },
  getTenantConfig: async () => null,
  upsertTenantConfig: async (configType: string, key: string, input: {
    value?: Record<string, unknown>; enabled?: boolean;
  }) => {
    writes.push({ operation: 'tenantConfig', input });
    return { id: 'config-one', configType, key, value: input.value || {}, enabled: input.enabled ?? true };
  },
}));
mock.module('../repositories/connectors.js', () => ({
  getConnectorConfigByRecordId: async () => ({
    provider_id: 'custom:one', runtime_kind: 'custom_oidc', enabled: true, category: 'enterprise_sso',
  }),
}));
mock.module('../repositories/enterprise-sso.js', () => ({
  createEnterpriseSSOConfig: async (input: {
    connectorId: string; domains: string[]; ssoProtocol?: string;
    jitProvisioning?: boolean; orgMembershipMapping?: Record<string, string>; roleMapping?: Record<string, string>;
  }) => {
    writes.push({ operation: 'enterprise', input });
    return {
      id: 'sso-one', ...input, ssoProtocol: input.ssoProtocol || 'oidc', jitProvisioning: input.jitProvisioning ?? false,
      orgMembershipMapping: input.orgMembershipMapping || {}, roleMapping: input.roleMapping || {},
    };
  },
}));
mock.module('../repositories/sign-in-experience.js', () => ({
  getSignInExperience: async () => experience,
  updateSignInExperience: async (input: unknown) => {
    writes.push({ operation: 'experience', input });
    return { id: 'experience-one' };
  },
  upsertApplicationSignInExperience: async (application_id: string, input: unknown) => {
    writes.push({ operation: 'applicationExperience', input });
    return { application_id, enabled: true, branding: {} };
  },
}));

const [{ applicationRoutes }, { resourceRoutes }, { tenantRoutes }, { tenantConfigRoutes },
  { connectorRoutes }, { enterpriseSSORoutes }, { sieRoutes }] = await Promise.all([
  import('../routes/applications.js'), import('../routes/resources.js'),
  import('../routes/tenant.js'), import('../routes/tenant-config.js'),
  import('../routes/connectors.js'), import('../routes/enterprise-sso.js'), import('../routes/sign-in-experience.js'),
]);
const app = new Elysia().onError(({ error, set }) => {
  if (error instanceof ApiContractError) {
    set.status = error.status;
    return { success: false, error: { code: error.code, message: error.message } };
  }
  set.status = 500;
  return { success: false, error: { message: 'Unexpected test error' } };
}).use(applicationRoutes).use(resourceRoutes).use(tenantRoutes).use(tenantConfigRoutes)
  .use(connectorRoutes).use(enterpriseSSORoutes).use(sieRoutes);

beforeEach(() => {
  writes.length = 0;
  audits.length = 0;
  providerReads = 0;
});

function request(path: string, method: string, body?: unknown) {
  return app.handle(new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined ? {} : {
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }),
  }));
}

describe('management input compatibility with successful legacy requests', () => {
  test('retains nullable scope descriptions in create, nested create and clearing updates', async () => {
    const nested = { name: 'Documents', indicator: resource.indicator, scopes: [{ name: 'read', description: null }] };
    expect((await request('/v1/resources', 'POST', nested)).status).toBe(200);
    const added = await request('/v1/resources/resource-one/scopes', 'POST', { name: 'read', description: null });
    expect(added.status).toBe(200);
    expect(await added.json()).toEqual(scope);
    expect((await request('/v1/resources/resource-one/scopes/scope-one', 'PUT', { description: null })).status).toBe(200);
    expect(writes).toEqual([
      { operation: 'createResource', input: nested },
      { operation: 'addScope', input: { name: 'read', description: null } },
      { operation: 'updateScope', input: { description: null } },
    ]);
    expect(audits).toHaveLength(3);
  });

  test('normalizes factory null defaults without dropping false or object values', async () => {
    const identity = { name: 'Example', protocol: 'oidc', category: 'enterprise_sso' };
    const response = await request('/v1/connectors/factories/oidc', 'PUT', {
      ...identity, config_schema: null, enabled: null,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ configSchema: {}, enabled: true });
    expect(writes).toEqual([{ operation: 'factory', input: identity }]);
    expect((await request('/v1/connectors/factories/oidc', 'PUT', {
      ...identity, config_schema: { nested: [1, null] }, enabled: false,
    })).status).toBe(200);
    expect(writes.at(-1)).toEqual({
      operation: 'factory', input: { ...identity, configSchema: { nested: [1, null] }, enabled: false },
    });
  });

  test('normalizes enterprise create null defaults after authoritative connector checks', async () => {
    const identity = { connector_id: connectorId, domains: ['example.test'] };
    const response = await request('/v1/enterprise-sso', 'POST', {
      ...identity, jit_provisioning: null, role_mapping: null, org_membership_mapping: null,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      jitProvisioning: false, roleMapping: {}, orgMembershipMapping: {},
    });
    expect(providerReads).toBe(1);
    expect(writes).toEqual([{
      operation: 'enterprise', input: { connectorId, domains: identity.domains, ssoProtocol: 'oidc' },
    }]);
    expect((await request('/v1/enterprise-sso', 'POST', {
      ...identity, jit_provisioning: false, role_mapping: { 'line\nbreak': 'reader' },
    })).status).toBe(200);
    expect(writes.at(-1)).toEqual({
      operation: 'enterprise', input: {
        connectorId, domains: identity.domains, ssoProtocol: 'oidc',
        jitProvisioning: false, roleMapping: { 'line\nbreak': 'reader' },
      },
    });
  });

  test('omits only null sign-in containers while retaining scalar updates and nullable contents', async () => {
    expect((await request('/v1/sign-in-experience', 'PUT', {
      branding: null, password_policy: null, sign_up_enabled: false,
    })).status).toBe(200);
    expect((await request('/v1/applications/app-one/sign-in-experience', 'PUT', {
      branding: null, enabled: false,
    })).status).toBe(200);
    expect((await request('/v1/sign-in-experience', 'PUT', {
      branding: { logo_url: null, content: [null, 'copy'] }, password_policy: { min_length: 12 },
    })).status).toBe(200);
    expect(writes).toEqual([
      { operation: 'experience', input: { sign_up_enabled: false } },
      { operation: 'applicationExperience', input: { enabled: false } },
      { operation: 'experience', input: {
        branding: { logo_url: null, content: [null, 'copy'] }, password_policy: { min_length: 12 },
      } },
    ]);
    expect(audits).toHaveLength(3);
  });

  test.each([
    { path: '/v1/resources', method: 'POST', body: { name: 'Documents', indicator: resource.indicator, scopes: [{ name: 'read', description: 1 }] } },
    { path: '/v1/resources/resource-one/scopes', method: 'POST', body: { name: 'read', description: {} } },
    { path: '/v1/resources/resource-one/scopes/scope-one', method: 'PUT', body: { description: false } },
    { path: '/v1/connectors/factories/oidc', method: 'PUT', body: { name: 'Example', protocol: 'oidc', category: 'enterprise_sso', config_schema: [] } },
    { path: '/v1/connectors/factories/oidc', method: 'PUT', body: { name: 'Example', protocol: 'oidc', category: 'enterprise_sso', enabled: 'true' } },
    { path: '/v1/enterprise-sso', method: 'POST', body: { connector_id: connectorId, domains: ['example.test'], jit_provisioning: 'false' } },
    { path: '/v1/enterprise-sso', method: 'POST', body: { connector_id: connectorId, domains: ['example.test'], role_mapping: { 'line\nbreak': 42 } } },
    { path: '/v1/enterprise-sso', method: 'POST', body: { connector_id: connectorId, domains: ['example.test'], org_membership_mapping: [] } },
    { path: '/v1/sign-in-experience', method: 'PUT', body: { branding: [] } },
    { path: '/v1/sign-in-experience', method: 'PUT', body: { password_policy: false } },
    { path: '/v1/sign-in-experience', method: 'PUT', body: { sign_up_enabled: null } },
    { path: '/v1/applications/app-one/sign-in-experience', method: 'PUT', body: { branding: 'default' } },
  ])('rejects malformed non-null fields before writes: $path $body', async ({ path, method, body }) => {
    expect((await request(path, method, body)).status).toBe(400);
    expect(writes).toHaveLength(0);
    expect(audits).toHaveLength(0);
    expect(providerReads).toBe(0);
  });

  test.each([
    { body: { connector_id: 'not-uuid', domains: ['example.test'] }, code: 'invalid_enterprise_sso_connector' },
    { body: { connector_id: connectorId, domains: ['example.test'], sso_protocol: null }, code: 'invalid_enterprise_sso_protocol' },
    { body: { connector_id: connectorId, domains: [] }, code: 'invalid_enterprise_sso_domains' },
  ])('preserves old enterprise preconditions: $code', async ({ body, code }) => {
    const response = await request('/v1/enterprise-sso', 'POST', body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(writes).toHaveLength(0);
    expect(audits).toHaveLength(0);
    expect(providerReads).toBe(0);
  });

  test('keeps the HEAD opaque string domain for actual decoded HTTP path parameters', async () => {
    const legacy = new Elysia().get('/v1/applications/:appId', ({ params }) => ({ client_id: params.appId }));
    for (const id of ['vendor/app', 'app\nid', '.hidden', 'application id', '%2e']) {
      const url = `http://localhost/v1/applications/${encodeURIComponent(id)}`;
      const previous = await legacy.handle(new Request(url));
      const current = await app.handle(new Request(url));
      expect(previous.status).toBe(200);
      expect(current.status).toBe(previous.status);
      expect(await current.json()).toEqual(await previous.json());
    }
  });

  test.each([
    { value: 'service' }, { value: null }, { value: { vendor: ['custom', 1] } },
  ])('preserves opaque OAuth type $value in create and update', async ({ value }) => {
    const create = { redirect_uris: ['https://client.example.test/callback'], type: value };
    expect((await request('/v1/applications', 'POST', create)).status).toBe(200);
    expect((await request('/v1/applications/app-one', 'PUT', { type: value })).status).toBe(200);
    expect(writes).toEqual([
      { operation: 'createApplication', input: create },
      { operation: 'updateApplication', input: { type: value } },
    ]);
  });

  test('keeps the empty OAuth update and strict protocol fields', async () => {
    expect((await request('/v1/applications/app-one', 'PUT', {})).status).toBe(200);
    expect(writes).toEqual([{ operation: 'updateApplication', input: {} }]);
    writes.length = 0;
    audits.length = 0;
    for (const body of [
      { redirect_uris: [] }, { grant_types: ['client_credentials'] }, { client_type: 'service' },
    ]) {
      expect((await request('/v1/applications/app-one', 'PUT', body)).status).toBe(400);
    }
    expect(writes).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  test('accepts absent resource body as the original timestamp-only update', async () => {
    const response = await request('/v1/resources/resource-one', 'PUT');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(resource);
    expect(writes).toEqual([{ operation: 'updateResource', input: {} }]);
    expect(audits).toHaveLength(1);
    expect(decodeSchema(sdkEndpoints.updateResource.input, { params: { resourceId: 'resource-one' } }))
      .toEqual({ params: { resourceId: 'resource-one' } });
  });

  test.each([{ body: null }, { body: [] }, { body: { name: 12 } }])(
    'rejects malformed resource body $body before writes', async ({ body }) => {
      expect((await request('/v1/resources/resource-one', 'PUT', body)).status).toBe(400);
      expect(writes).toHaveLength(0);
      expect(audits).toHaveLength(0);
    },
  );

  test.each([
    { body: {} }, { body: { enabled: false } }, { body: { value: null } },
    { body: { enabled: null } }, { body: { value: null, enabled: null } },
  ])(
    'preserves tenant defaults for $body', async ({ body }) => {
      const response = await request('/v1/tenant-config/domain/default', 'PUT', body);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        configType: 'domain', value: {}, enabled: 'enabled' in body ? body.enabled ?? true : true,
      });
      expect(writes).toHaveLength(1);
    },
  );

  test.each([{ body: { value: null } }, { body: { value: null, enabled: null } }])(
    'preserves null CAPTCHA fields through the existing disabled/default-provider branch', async ({ body }) => {
    const response = await request('/v1/tenant-config/captcha/default', 'PUT', body);
    expect(response.status).toBe(200);
    expect(writes).toEqual([
      { operation: 'captcha', input: { security_captcha_enabled: false, security_captcha_provider: 'none' } },
      { operation: 'tenantConfig', input: { value: { provider: 'none', secret_configured: false }, enabled: false } },
    ]);
  });

  test.each([
    { path: 'domain/default', body: { value: 123 }, code: 'invalid_request_body' },
    { path: 'domain/default', body: { value: { hostname: false } }, code: 'invalid_request_body' },
    { path: 'domain/default', body: { enabled: 'true' }, code: 'invalid_request_body' },
    { path: 'domain/default', body: { enabled: 0 }, code: 'invalid_request_body' },
    { path: 'domain/default', body: { enabled: [] }, code: 'invalid_request_body' },
    { path: 'domain/default', body: { value: { client_secret: 'test-only' } }, code: 'secret_not_allowed' },
    { path: 'account_center/default', body: { value: { delete_account_url: 'http://unsafe.example.test' } }, code: 'invalid_delete_account_url' },
  ])('retains tenant boundary $code', async ({ path, body, code }) => {
    const response = await request(`/v1/tenant-config/${path}`, 'PUT', body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(writes).toHaveLength(0);
  });

  test.each(['consent', 'access-control'])('restores nullable %s defaults', async (suffix) => {
    const response = await request(`/v1/applications/app-one/${suffix}`, 'PUT', {
      user_scopes: null, organization_scopes: null, allowed_organization_ids: null,
      require_explicit_consent: null, custom_data: null,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      applicationId: 'app-one', userScopes: [], organizationScopes: [], allowedOrganizationIds: [],
      requireExplicitConsent: true, customData: {},
    });
    expect(writes).toEqual([{ operation: 'consent', input: {} }]);
  });

  test.each([
    { body: { user_scopes: [1] } }, { body: { require_explicit_consent: 'false' } },
    { body: { custom_data: [] } },
  ])('still rejects invalid non-null consent fields', async ({ body }) => {
    expect((await request('/v1/applications/app-one/consent', 'PUT', body)).status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  test('normalizes collaborator role/status before forwarding to the authority', async () => {
    expect((await request('/v1/tenant/members/member-one', 'PATCH', {
      role: ' AdMiN ', status: ' SUSPENDED ',
    })).status).toBe(200);
    expect((await request('/v1/tenant/members/member-one', 'PATCH', { status: ' \t' })).status).toBe(200);
    expect((await request('/v1/tenant/invitations', 'POST', {
      email: 'admin@example.test', role: ' ADMIN ',
    })).status).toBe(200);
    expect(writes).toEqual([
      { operation: 'updateTenantMember', input: { role: 'admin', status: 'suspended' } },
      { operation: 'updateTenantMember', input: {} },
      { operation: 'createTenantInvitation', input: { email: 'admin@example.test', role: 'admin' } },
    ]);
  });

  test.each([
    { path: '/members/member-one', method: 'PATCH', body: { role: 'superuser' } },
    { path: '/members/member-one', method: 'PATCH', body: { role: 123 } },
    { path: '/members/member-one', method: 'PATCH', body: { status: 'deleted' } },
    { path: '/members/member-one', method: 'PATCH', body: { role: 'admin viewer' } },
    { path: '/invitations', method: 'POST', body: { email: 'admin@example.test', role: ' OWNER ' } },
  ])('rejects non-authoritative collaborator role/status', async ({ path, method, body }) => {
    expect((await request(`/v1/tenant${path}`, method, body)).status).toBe(400);
    expect(writes).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });
});
