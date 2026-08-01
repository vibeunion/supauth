import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { GOTRUE_PASSWORD_CHARACTER_POLICIES } from '../utils/password-policy.js';

process.env.SUPACLOUD_INTERNAL_API_URL = 'http://supacloud.internal';
process.env.SUPACLOUD_INTERNAL_TOKEN = 'test-token';
process.env.SUPAOAUTH_BFF_SIGNING_SECRET = 'test-bff-signing-secret-32-characters';
process.env.SUPACLOUD_PROJECT_REF = 'test-project';
process.env.SUPACLOUD_RUNTIME_URL = 'http://runtime.internal';
process.env.SUPACLOUD_DATABASE_URL = 'postgres://test';
process.env.ADMIN_AUTH_MODE = 'token';
process.env.NODE_ENV = 'test';

const updateAuthConfig = mock(async (_requested: Record<string, unknown>) => ({}));
const getAuthConfig = mock(async (): Promise<Record<string, unknown>> => ({
  password_min_length: 12,
  password_required_characters: '',
}));
const logAudit = mock(async () => ({}));

mock.module('../supacloud/adapter.js', () => ({
  SupaCloudApiError: class SupaCloudApiError extends Error {
    status = 500;
    body = '';
    path = '';
  },
  getSupaCloudAdapter: () => ({ updateAuthConfig, getAuthConfig }),
  isSupaCloudApiError: () => false,
}));

mock.module('../repositories/audit.js', () => ({ logAudit }));

const { observabilityMiddleware } = await import('../middleware/index.js');
const { authConfigRoutes } = await import('../routes/sign-in-experience.js');

const app = new Elysia()
  .use(observabilityMiddleware)
  .use(authConfigRoutes);

function passwordPolicyRequest(
  requiredCharacters: string = GOTRUE_PASSWORD_CHARACTER_POLICIES.standard,
) {
  return new Request('http://localhost/v1/auth-config/', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      password_min_length: 12,
      password_required_characters: requiredCharacters,
    }),
  });
}

describe('GoTrue auth configuration write-back consistency', () => {
  beforeEach(() => {
    updateAuthConfig.mockClear();
    getAuthConfig.mockClear();
    logAudit.mockClear();
    getAuthConfig.mockImplementation(async () => ({
      password_min_length: 12,
      password_required_characters: '',
    }));
  });

  test('fails closed when the platform drops the requested character policy', async () => {
    const response = await app.handle(passwordPolicyRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      success: false,
      error: {
        code: 'runtime_config_mismatch',
        details: { fields: ['password_required_characters'] },
      },
    });
    expect(updateAuthConfig).toHaveBeenCalledTimes(1);
    expect(getAuthConfig).toHaveBeenCalledTimes(1);
    expect(logAudit).not.toHaveBeenCalled();
  });

  test('returns the authoritative policy and audits only after matching read-back', async () => {
    getAuthConfig.mockImplementation(async () => ({
      password_min_length: 12,
      password_required_characters: GOTRUE_PASSWORD_CHARACTER_POLICIES.standard,
    }));

    const response = await app.handle(passwordPolicyRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      password_min_length: 12,
      password_required_characters: GOTRUE_PASSWORD_CHARACTER_POLICIES.standard,
    });
    expect(logAudit).toHaveBeenCalledTimes(1);
  });

  test('accepts and reads back the exact strong GoTrue character policy', async () => {
    getAuthConfig.mockImplementation(async () => ({
      password_min_length: 12,
      password_required_characters: GOTRUE_PASSWORD_CHARACTER_POLICIES.strong,
    }));

    const response = await app.handle(passwordPolicyRequest(
      GOTRUE_PASSWORD_CHARACTER_POLICIES.strong,
    ));

    expect(response.status).toBe(200);
    expect(updateAuthConfig).toHaveBeenCalledWith({
      password_min_length: 12,
      password_required_characters: GOTRUE_PASSWORD_CHARACTER_POLICIES.strong,
    });
    expect(await response.json()).toMatchObject({
      password_required_characters: GOTRUE_PASSWORD_CHARACTER_POLICIES.strong,
    });
    expect(GOTRUE_PASSWORD_CHARACTER_POLICIES.strong).toContain('\\\\');
    expect(logAudit).toHaveBeenCalledTimes(1);
  });

  test('rejects an unsupported character policy before writing GoTrue config', async () => {
    const response = await app.handle(passwordPolicyRequest('lower:upper:custom'));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      error: { code: 'invalid_password_policy' },
    });
    expect(updateAuthConfig).not.toHaveBeenCalled();
    expect(getAuthConfig).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });
});
