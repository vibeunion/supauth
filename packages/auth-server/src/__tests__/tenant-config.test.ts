import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { operationTestPlugin } from './http-fixture.js';

process.env.NODE_ENV = 'production';

interface TenantConfigRow {
  id: string;
  configType: string;
  key: string;
  value: Record<string, unknown>;
  enabled: boolean;
}

const tenantConfigs = new Map<string, TenantConfigRow>();
const getTenantConfig = mock(async (configType: string, key: string) => (
  tenantConfigs.get(`${configType}:${key}`) ?? null
));
const upsertTenantConfig = mock(async (
  configType: string,
  key: string,
  input: { value?: Record<string, unknown>; enabled?: boolean },
) => {
  const row = {
    id: 'config-1',
    configType,
    key,
    value: input.value || {},
    enabled: input.enabled ?? true,
  };
  tenantConfigs.set(`${configType}:${key}`, row);
  return row;
});

mock.module('../supacloud/adapter.js', () => ({
  SupaCloudApiError: class SupaCloudApiError extends Error {
    status = 500;
    body = '';
    path = '';
  },
  isSupaCloudApiError: () => false,
  getSupaCloudAdapter: () => ({
    getProject: async () => ({}),
    getAuthConfig: async () => ({ password_min_length: 8, password_required_characters: '' }),
    listProviders: async () => [],
  }),
}));

mock.module('../repositories/tenant-config.js', () => ({
  listTenantConfigs: mock(async () => []),
  getTenantConfig,
  upsertTenantConfig,
  deleteTenantConfig: mock(async () => null),
}));

mock.module('../repositories/sign-in-experience.js', () => ({
  resolveSignInExperience: async () => ({ branding: {}, sign_in_methods: ['password'], sign_up_enabled: true }),
}));

mock.module('../repositories/connectors.js', () => ({
  listEnabledConnectorConfigs: async () => [],
}));

mock.module('../repositories/audit.js', () => ({
  logAudit: mock(async () => ({})),
}));

const { observabilityMiddleware } = await import('../middleware/index.js');
const { publicSignInExperienceRoutes } = await import('../routes/sign-in-experience.js');
const { tenantConfigRoutes } = await import('../routes/tenant-config.js');

const app = new Elysia()
  .use(observabilityMiddleware)
  .use(operationTestPlugin([tenantConfigRoutes, publicSignInExperienceRoutes]));

beforeEach(() => {
  tenantConfigs.clear();
  upsertTenantConfig.mockClear();
});

const unsafeAccountCenterValues: Array<[string, Record<string, unknown>]> = [
  ['nested credentials', { delete_account: { enabled: true, url: 'https://user:secret@example.test/delete' } }],
  ['legacy fragment', { delete_account_url: 'https://example.test/delete#confirm' }],
  [
    'unsafe legacy alias beside a safe nested value',
    {
      delete_account: { enabled: true, url: 'https://example.test/delete' },
      delete_account_url: 'javascript:alert(1)',
    },
  ],
  ['external HTTP', { delete_account: { enabled: true, url: 'http://example.test/delete' } }],
  ['production loopback HTTP', { delete_account: { enabled: true, url: 'http://127.0.0.2/delete' } }],
  ['disguised integer loopback', { delete_account_url: 'http://2130706433/delete' }],
  ['relative URL', { delete_account: { enabled: true, url: '/delete' } }],
];

const safeAccountCenterValues: Array<[string, Record<string, unknown>]> = [
  [
    'HTTPS URL',
    {
      delete_account: { enabled: true, url: 'https://example.test/delete' },
      delete_account_url: 'https://example.test/delete',
    },
  ],
  [
    'empty built-in flow',
    {
      delete_account: { enabled: true, url: null },
      delete_account_url: null,
    },
  ],
];

function accountCenterRequest(value: Record<string, unknown>) {
  return new Request('http://localhost/v1/tenant-config/account_center/default', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true, value }),
  });
}

describe('account center tenant config URL boundary', () => {
  test.each(unsafeAccountCenterValues)('returns stable 400 without writing: %s', async (_caseName, value) => {
    const response = await app.handle(accountCenterRequest(value));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      error: {
        code: 'invalid_delete_account_url',
        message: 'External delete account URL must use HTTPS without credentials or fragments; HTTP is limited to literal loopback hosts in development or test',
      },
    });
    expect(upsertTenantConfig).not.toHaveBeenCalled();
  });

  test.each(safeAccountCenterValues)('writes safe config: %s', async (_caseName, value) => {
    const response = await app.handle(accountCenterRequest(value));

    expect(response.status).toBe(200);
    expect(upsertTenantConfig).toHaveBeenCalledTimes(1);
    expect(upsertTenantConfig).toHaveBeenCalledWith('account_center', 'default', {
      enabled: true,
      value,
    });
  });
});

describe('default login email domain config', () => {
  function request(data: unknown) {
    return new Request('http://localhost/v1/tenant-config/sign_in/default_email_domain', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  async function resolve() {
    const response = await app.handle(new Request('http://localhost/v1/public/sign-in-experience/resolve'));
    expect(response.status).toBe(200);
    return response.json();
  }

  test.each(['company.test', null])('stores the domain or clears it: %s', async (domain) => {
    const config = { enabled: domain !== null, value: { domain } };
    const response = await app.handle(request(config));

    expect(response.status).toBe(200);
    expect(upsertTenantConfig).toHaveBeenCalledWith('sign_in', 'default_email_domain', config);
  });

  test.each(['user@company.test', 'https://company.test', 'company..test', '-company.test', 'company.test\n'])(
    'rejects an invalid domain without storing it: %s',
    async (domain) => {
      const response = await app.handle(request({ enabled: true, value: { domain } }));

      expect(response.status).toBe(400);
      expect(upsertTenantConfig).not.toHaveBeenCalled();
    },
  );

  test('does not persist a malformed empty config that would fail subsequent reads', async () => {
    const response = await app.handle(request({ enabled: true }));

    expect(response.status).toBe(400);
    expect(upsertTenantConfig).not.toHaveBeenCalled();
  });

  test('publishes the saved domain and omits it again after clearing', async () => {
    expect(await resolve()).not.toHaveProperty('default_email_domain');
    expect((await app.handle(request({ enabled: true, value: { domain: 'company.test' } }))).status).toBe(200);
    expect(await resolve()).toHaveProperty('default_email_domain', 'company.test');

    expect((await app.handle(request({ enabled: false, value: { domain: null } }))).status).toBe(200);
    expect(await resolve()).not.toHaveProperty('default_email_domain');
  });

  test('still resolves sign-in when the optional domain lookup fails', async () => {
    expect((await app.handle(request({ enabled: true, value: { domain: 'company.test' } }))).status).toBe(200);
    getTenantConfig.mockRejectedValueOnce(new Error('Tenant config temporarily unavailable'));

    const experience = await resolve();
    expect(experience).not.toHaveProperty('default_email_domain');
    expect(experience).toMatchObject({
      sign_in_methods: ['password'],
      password_policy: { min_length: 8 },
    });
    expect(await resolve()).toHaveProperty('default_email_domain', 'company.test');
  });
});
