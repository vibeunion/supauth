import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';

process.env.NODE_ENV = 'production';

const upsertTenantConfig = mock(async (
  configType: string,
  key: string,
  input: { value?: Record<string, unknown>; enabled?: boolean },
) => ({
  id: 'config-1',
  configType,
  key,
  value: input.value || {},
  enabled: input.enabled ?? true,
}));

mock.module('../supacloud/adapter.js', () => ({
  SupaCloudApiError: class SupaCloudApiError extends Error {
    status = 500;
    body = '';
    path = '';
  },
  getSupaCloudAdapter: () => ({}),
}));

mock.module('../repositories/tenant-config.js', () => ({
  listTenantConfigs: mock(async () => []),
  getTenantConfig: mock(async () => null),
  upsertTenantConfig,
  deleteTenantConfig: mock(async () => null),
}));

mock.module('../repositories/audit.js', () => ({
  logAudit: mock(async () => ({})),
}));

const { observabilityMiddleware } = await import('../middleware/index.js');
const { tenantConfigRoutes } = await import('../routes/tenant-config.js');

const app = new Elysia()
  .use(observabilityMiddleware)
  .use(tenantConfigRoutes);

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
  beforeEach(() => {
    upsertTenantConfig.mockClear();
  });

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
