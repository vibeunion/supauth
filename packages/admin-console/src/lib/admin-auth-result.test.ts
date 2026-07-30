// Bun runs this module directly; the Svelte check does not include Bun's test globals.
// @ts-nocheck
import { describe, expect, test } from 'bun:test';
import { adminCheckFailure } from './admin-auth-result.js';

describe('admin auth check failure classification', () => {
  test('restarts login only for authentication expiry', () => {
    expect(adminCheckFailure(Object.assign(new Error('Unauthorized'), { statusCode: 401 })))
      .toEqual({ authenticated: false, redirectTo: '/admin/login', logout: true });
  });

  test('keeps forbidden distinct from authentication expiry', () => {
    expect(adminCheckFailure(Object.assign(new Error('Forbidden'), { statusCode: 403 })))
      .toEqual({ authenticated: false, error: { message: 'Forbidden' } });
  });

  test('keeps MFA-required 403 out of logout and login redirect loops', () => {
    expect(adminCheckFailure(Object.assign(new Error('server detail'), {
      statusCode: 403,
      code: 'admin_mfa_required',
    }))).toEqual({
      authenticated: false,
      error: {
        message: '管理员必须完成双因素认证。请前往账户中心 /account 启用 GoTrue TOTP，然后重新登录管理后台。',
        name: 'admin_mfa_required',
      },
    });
  });

  test('does not start a login loop for retryable service failures', () => {
    expect(adminCheckFailure(Object.assign(new Error('Auth service unavailable'), { statusCode: 503 })))
      .toEqual({ authenticated: false, error: { message: 'Auth service unavailable' } });
  });
});
