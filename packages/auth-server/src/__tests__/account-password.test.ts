import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  changePasswordWithGoTrue,
  createPublicAccountPasswordRoutes,
} from '../routes/account-password.js';

describe('account password self-service', () => {
  test('changes password through GoTrue password grant and user update', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/token?grant_type=password')) {
        return Response.json({
          access_token: 'user-access-token',
          user: { id: 'user-1', email: 'user@example.test' },
        });
      }
      if (String(url).endsWith('/auth/v1/user')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer user-access-token' });
        expect(JSON.parse(String(init?.body))).toEqual({ password: 'NewPass123!' });
        return Response.json({ id: 'user-1', email: 'user@example.test' });
      }
      return Response.json({ message: 'not found' }, { status: 404 });
    };

    const result = await changePasswordWithGoTrue({
      email: 'user@example.test',
      currentPassword: 'OldPass123!',
      newPassword: 'NewPass123!',
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      runtimeBaseUrls: ['https://auth.example.test'],
    });

    expect(result).toEqual({ ok: true, userId: 'user-1' });
    expect(calls.map(call => call.url)).toEqual([
      'https://auth.example.test/auth/v1/token?grant_type=password',
      'https://auth.example.test/auth/v1/user',
    ]);
  });

  test('does not update password when current password is invalid', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string | URL | Request) => {
      calls.push(String(url));
      return Response.json({ msg: 'Invalid login credentials' }, { status: 400 });
    };

    const result = await changePasswordWithGoTrue({
      email: 'user@example.test',
      currentPassword: 'wrong',
      newPassword: 'NewPass123!',
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      runtimeBaseUrls: ['https://auth.example.test'],
    });

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      code: 'invalid_current_password',
    });
    expect(calls).toEqual(['https://auth.example.test/auth/v1/token?grant_type=password']);
  });

  test('public route validates input and returns a stable success response', async () => {
    const app = new Elysia().use(createPublicAccountPasswordRoutes({
      changePassword: async (input) => {
        expect(input).toEqual({
          email: 'user@example.test',
          currentPassword: 'OldPass123!',
          newPassword: 'NewPass123!',
        });
        return { ok: true, userId: 'user-1' };
      },
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account-password/change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: ' USER@example.test ',
        current_password: 'OldPass123!',
        new_password: 'NewPass123!',
        confirm_password: 'NewPass123!',
      }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, status: 'password_changed' });
  });

  test('public route rejects mismatched password confirmation', async () => {
    const app = new Elysia().use(createPublicAccountPasswordRoutes({
      changePassword: async () => ({ ok: true }),
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account-password/change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user@example.test',
        current_password: 'OldPass123!',
        new_password: 'NewPass123!',
        confirm_password: 'Mismatch123!',
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('password_mismatch');
  });
});
