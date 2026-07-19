import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

type JitCapability = {
  available: boolean;
  source: string;
  version: string | null;
  reason_code: string | null;
};

const getCapabilities = mock(async (): Promise<{
  capabilities: { business_organization_jit_v1: JitCapability };
}> => ({
  capabilities: {
    business_organization_jit_v1: {
      available: true,
      source: 'gotrue',
      version: 'gotrue-custom-access-token-hook-v1',
      reason_code: null,
    },
  },
}));
const getOrganizationJitSettings = mock(async () => ({ enabled: true, domains: ['example.test'] }));
const updateOrganizationJitSettings = mock(async () => ({ enabled: true, domains: ['example.test'] }));

mock.module('../supacloud/adapter.js', () => ({
  getSupaCloudAdapter: () => ({
    getCapabilities,
    getOrganizationJitSettings,
    updateOrganizationJitSettings,
  }),
}));
mock.module('../repositories/audit.js', () => ({ logAudit: mock(async () => ({})) }));
mock.module('../repositories/webhook-delivery.js', () => ({
  buildEvent: mock(() => ({})),
  dispatchEvent: mock(async () => undefined),
}));

const { organizationRoutes } = await import('../routes/organizations.js');
const app = new Elysia()
  .onError(({ error, set }) => {
    if (error && typeof error === 'object' && 'status' in error) {
      set.status = Number(error.status);
      return { code: 'code' in error ? error.code : 'error', details: 'details' in error ? error.details : undefined };
    }
  })
  .use(organizationRoutes);

describe('organization JIT capability gate', () => {
  beforeEach(() => {
    getCapabilities.mockClear();
    getCapabilities.mockResolvedValue({
      capabilities: {
        business_organization_jit_v1: {
          available: true,
          source: 'gotrue',
          version: 'gotrue-custom-access-token-hook-v1',
          reason_code: null,
        },
      },
    });
    getOrganizationJitSettings.mockClear();
    updateOrganizationJitSettings.mockClear();
  });

  it('opens JIT settings only when runtime evidence marks the capability available', async () => {
    const response = await app.handle(new Request('http://localhost/v1/organizations/org-one/jit'));

    expect(response.status).toBe(200);
    expect(getOrganizationJitSettings).toHaveBeenCalledWith('org-one');
  });

  it('returns capability_unavailable and preserves the runtime reason code', async () => {
    getCapabilities.mockResolvedValueOnce({
      capabilities: {
        business_organization_jit_v1: {
          available: false,
          source: 'gotrue',
          version: null,
          reason_code: 'gotrue_custom_access_token_hook_not_enabled',
        },
      },
    });

    const response = await app.handle(new Request('http://localhost/v1/organizations/org-one/jit'));
    const body = await response.json() as any;

    expect(response.status).toBe(501);
    expect(body.code).toBe('capability_unavailable');
    expect(body.details.reason_code).toBe('gotrue_custom_access_token_hook_not_enabled');
    expect(getOrganizationJitSettings).not.toHaveBeenCalled();
  });
});
