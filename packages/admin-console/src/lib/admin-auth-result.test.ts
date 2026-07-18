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

  test('does not start a login loop for retryable service failures', () => {
    expect(adminCheckFailure(Object.assign(new Error('Auth service unavailable'), { statusCode: 503 })))
      .toEqual({ authenticated: false, error: { message: 'Auth service unavailable' } });
  });
});
