import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { decodeSchema } from '../../../shared/src/schema.js';
import { AdminLoginResponseSchema } from '../../../shared/src/admin-auth-contracts.js';

process.env.NODE_ENV = 'test';
process.env["ADMIN_AUTH_MODE"] = 'auto';
process.env["ADMIN_TOKEN"] = 'compatibility-fixture-token';
process.env["ADMIN_MAX_LOGIN_ATTEMPTS"] = '2';
mock.module('../repositories/security-config.js', () => ({ getSecurityConfig: async () => null }));
const { authRoutes, verifyAdminBearer } = await import('../auth/index.js');
const app = new Elysia().use(authRoutes);

function login(body: unknown) {
  return app.handle(new Request('http://localhost/v1/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}

beforeEach(async () => {
  process.env.NODE_ENV = 'test';
  // 成功认证沿既有路径清除失败计数，测试不直接改会话或限流内部状态。
  const response = await login({ token: 'compatibility-fixture-token' });
  expect(response.status).toBe(200);
});
afterAll(() => {
  delete process.env["ADMIN_MAX_LOGIN_ATTEMPTS"];
});

describe('admin login historical credential envelope', () => {
  test('accepts a matching token with ignored JSON fields and creates a real local session', async () => {
    const response = await login({ token: 'compatibility-fixture-token', remember: true, extra: { source: 'fixture' } });
    expect(response.status).toBe(200);
    const payload = decodeSchema(AdminLoginResponseSchema, await response.json());
    if (!payload.success) throw new Error('Expected successful fixture login');
    expect(await verifyAdminBearer({ authorization: `Bearer ${payload.token}` }))
      .toMatchObject({ status: 'authenticated', session: { id: 'admin' } });
  });

  test.each([{}, { token: '' }, { token: null }, { token: 42 }, { token: { nested: true } }])(
    'retains invalid credentials as the historical failure envelope: %j',
    async (body) => {
      const response = await login(body);
      expect(response.status).toBe(200);
      expect(decodeSchema(AdminLoginResponseSchema, await response.json())).toEqual({
        success: false, error: { message: 'Invalid credentials' },
      });
    },
  );

  test('does not enable development-token authentication in production', async () => {
    process.env.NODE_ENV = 'production';
    const response = await login({ token: 'compatibility-fixture-token', remember: true });
    expect(response.status).toBe(200);
    expect(decodeSchema(AdminLoginResponseSchema, await response.json())).toEqual({
      success: false, error: { message: 'Token login is disabled in production; use SSO' },
    });
  });

  test('still records empty-object credential failures and locks subsequent attempts', async () => {
    expect((await login({})).status).toBe(200);
    expect((await login({})).status).toBe(200);
    expect((await login({ token: 'compatibility-fixture-token', remember: true })).status).toBe(429);
  });
});
