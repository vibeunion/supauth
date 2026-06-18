import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  createPublicAccountRoutes,
  enrollTotpMfaWithGoTrue,
  getAccountWithGoTrue,
  sanitizeAccountCenterConfig,
  unenrollMfaFactorWithGoTrue,
  updateAccountContactWithGoTrue,
  updateAccountProfileWithGoTrue,
  verifyTotpMfaWithGoTrue,
} from '../routes/account-self-service.js';

const permissiveAccountCenterConfig = sanitizeAccountCenterConfig({
  enabled: true,
  value: {
    profile: {
      edit_mode: 'editable',
      fields: ['name', 'email', 'phone'],
    },
    security: {
      password_change: true,
      mfa: true,
      passkeys: true,
      email_change: true,
      phone_change: true,
    },
    sessions: { enabled: true },
    grants: { enabled: true },
    identities: { enabled: true },
    delete_account: { enabled: true },
  },
});

function routes(options: Parameters<typeof createPublicAccountRoutes>[0] = {}) {
  return createPublicAccountRoutes({
    getConfig: async () => permissiveAccountCenterConfig,
    ...options,
  });
}

describe('account self-service API', () => {
  test('gets current account through GoTrue user endpoint with bearer token', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Response.json({
        id: 'user-1',
        email: 'user@example.test',
        role: 'authenticated',
        user_metadata: { name: 'User One' },
        app_metadata: { provider: 'email' },
      });
    };

    const result = await getAccountWithGoTrue('user-access-token', {
      fetchImpl: fetchImpl as typeof fetch,
      runtimeBaseUrls: ['https://auth.example.test'],
    });

    expect(result).toEqual({
      ok: true,
      user: {
        id: 'user-1',
        aud: undefined,
        role: 'authenticated',
        email: 'user@example.test',
        phone: undefined,
        email_confirmed_at: undefined,
        phone_confirmed_at: undefined,
        last_sign_in_at: undefined,
        created_at: undefined,
        updated_at: undefined,
        user_metadata: { name: 'User One' },
        app_metadata: { provider: 'email' },
        identities: [],
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://auth.example.test/auth/v1/user');
    expect(calls[0].init?.headers).toMatchObject({ Authorization: 'Bearer user-access-token' });
  });

  test('updates profile metadata with the user bearer token only', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      expect(init?.headers).toMatchObject({
        'Content-Type': 'application/json',
        Authorization: 'Bearer user-access-token',
      });
      expect(JSON.parse(String(init?.body))).toEqual({ data: { name: 'Updated User' } });
      return Response.json({
        id: 'user-1',
        email: 'user@example.test',
        user_metadata: { name: 'Updated User' },
      });
    };

    const result = await updateAccountProfileWithGoTrue('user-access-token', { name: 'Updated User' }, {
      fetchImpl: fetchImpl as typeof fetch,
      runtimeBaseUrls: ['https://auth.example.test/auth/v1'],
      audit: false,
    });

    expect(result).toMatchObject({
      ok: true,
      user: {
        id: 'user-1',
        email: 'user@example.test',
        user_metadata: { name: 'Updated User' },
      },
    });
    expect(calls.map(call => call.url)).toEqual(['https://auth.example.test/auth/v1/user']);
  });

    test('updates email and phone through GoTrue user endpoint with the user bearer token', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
        expect(init?.headers).toMatchObject({
          'Content-Type': 'application/json',
          Authorization: 'Bearer user-access-token',
        });
        return Response.json({
          id: 'user-1',
          email: 'new@example.test',
        phone: '+15551234567',
        user_metadata: {},
      });
    };

    const emailResult = await updateAccountContactWithGoTrue('user-access-token', { email: 'new@example.test' }, {
      fetchImpl: fetchImpl as typeof fetch,
      runtimeBaseUrls: ['https://auth.example.test'],
    });
    const phoneResult = await updateAccountContactWithGoTrue('user-access-token', { phone: '+15551234567' }, {
      fetchImpl: fetchImpl as typeof fetch,
      runtimeBaseUrls: ['https://auth.example.test/auth/v1'],
    });

    expect(emailResult).toMatchObject({ ok: true, user: { id: 'user-1', email: 'new@example.test' } });
    expect(phoneResult).toMatchObject({ ok: true, user: { id: 'user-1', phone: '+15551234567' } });
    expect(calls.map(call => JSON.parse(String(call.init?.body)))).toEqual([
      { email: 'new@example.test' },
      { phone: '+15551234567' },
    ]);
      expect(calls.map(call => call.url)).toEqual([
        'https://auth.example.test/auth/v1/user',
        'https://auth.example.test/auth/v1/user',
      ]);
    });

    test('enrolls TOTP MFA through GoTrue without returning the raw secret', async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        expect(init?.headers).toMatchObject({
          'Content-Type': 'application/json',
          Authorization: 'Bearer user-access-token',
        });
        expect(JSON.parse(String(init?.body))).toEqual({
          factor_type: 'totp',
          friendly_name: 'Work phone',
          issuer: 'SupAuth',
        });
        return Response.json({
          id: 'factor-1',
          type: 'totp',
          status: 'unverified',
          friendly_name: 'Work phone',
          totp: {
            qr_code: 'data:image/svg+xml;base64,abc',
            uri: 'otpauth://totp/SupAuth:user@example.test?secret=SECRET',
            secret: 'SECRET',
          },
        });
      };

      const result = await enrollTotpMfaWithGoTrue('user-access-token', {
        friendly_name: 'Work phone',
        issuer: 'SupAuth',
      }, {
        fetchImpl: fetchImpl as typeof fetch,
        runtimeBaseUrls: ['https://auth.example.test'],
      });

      expect(result).toEqual({
        ok: true,
        data: {
          factor_id: 'factor-1',
          id: 'factor-1',
          type: 'totp',
          status: 'unverified',
          friendly_name: 'Work phone',
          totp: {
            qr_code: 'data:image/svg+xml;base64,abc',
            uri: 'otpauth://totp/SupAuth:user@example.test?secret=SECRET',
          },
        },
      });
      expect(JSON.stringify(result)).not.toContain('"secret"');
      expect(calls.map(call => call.url)).toEqual(['https://auth.example.test/auth/v1/factors']);
    });

    test('verifies TOTP MFA by creating a GoTrue challenge first', async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        expect(init?.headers).toMatchObject({
          'Content-Type': 'application/json',
          Authorization: 'Bearer user-access-token',
        });
        if (String(url).endsWith('/challenge')) {
          expect(JSON.parse(String(init?.body))).toEqual({});
          return Response.json({ id: 'challenge-1' });
        }
        expect(JSON.parse(String(init?.body))).toEqual({ code: '123456', challenge_id: 'challenge-1' });
        return Response.json({ id: 'factor-1', status: 'verified' });
      };

      const result = await verifyTotpMfaWithGoTrue('user-access-token', 'factor-1', { code: '123456' }, {
        fetchImpl: fetchImpl as typeof fetch,
        runtimeBaseUrls: ['https://auth.example.test'],
      });

      expect(result).toEqual({ ok: true, data: { id: 'factor-1', status: 'verified' } });
    expect(calls.map(call => call.url)).toEqual([
      'https://auth.example.test/auth/v1/factors/factor-1/challenge',
      'https://auth.example.test/auth/v1/factors/factor-1/verify',
    ]);
  });

  test('unenrolls an MFA factor through GoTrue with the user bearer token', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      expect(init?.method).toBe('DELETE');
      expect(init?.headers).toMatchObject({
        'Content-Type': 'application/json',
        Authorization: 'Bearer user-access-token',
      });
      return new Response(null, { status: 204 });
    };

    const result = await unenrollMfaFactorWithGoTrue('user-access-token', 'factor-1', {
      fetchImpl: fetchImpl as typeof fetch,
      runtimeBaseUrls: ['https://auth.example.test'],
    });

    expect(result).toEqual({ ok: true, data: { id: 'factor-1', status: 'unenrolled' } });
    expect(calls.map(call => call.url)).toEqual(['https://auth.example.test/auth/v1/factors/factor-1']);
  });

  test('sanitizes public account center config and drops unknown fields', () => {
    const config = sanitizeAccountCenterConfig({
      enabled: true,
      value: {
        enabled: true,
        profile: {
          edit_mode: 'editable',
          fields: ['name', 'email', 'role', '../bad', 'phone', 'name'],
        },
        security: {
          password_change: false,
          mfa: true,
          passkeys: true,
          email_change: true,
          phone_change: true,
          internal_secret: 'blocked',
        },
        sessions: { enabled: true, secret: 'blocked' },
        grants: { enabled: false },
        identities: { enabled: true },
        delete_account: { enabled: true, url: 'https://example.test/delete' },
        admin_token: 'blocked',
      },
    });

    expect(config).toEqual({
      enabled: true,
      profile: {
        edit_mode: 'editable',
        fields: ['name', 'email', 'role', 'phone'],
      },
      security: {
        password_change: false,
        mfa: true,
        passkeys: true,
        email_change: true,
        phone_change: true,
      },
      sessions: { enabled: true },
      grants: { enabled: false },
      identities: { enabled: true },
      delete_account: { enabled: true, url: 'https://example.test/delete' },
    });
  });

  test('public route requires a bearer token', async () => {
    const app = new Elysia().use(routes({
      getAccount: async () => ({ ok: true, user: { id: 'user-1' } }),
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account/me'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      success: false,
      error: { code: 'missing_token', message: 'Bearer access token is required.' },
    });
  });

  test('public route reads current account with the supplied bearer token', async () => {
    const app = new Elysia().use(routes({
      getAccount: async (token) => {
        expect(token).toBe('user-access-token');
        return { ok: true, user: { id: 'user-1', email: 'user@example.test' } };
      },
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account/me', {
      headers: { Authorization: 'Bearer user-access-token' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      user: { id: 'user-1', email: 'user@example.test' },
    });
  });

  test('public config route does not require a token', async () => {
    const app = new Elysia().use(routes({
      getConfig: async () => sanitizeAccountCenterConfig({
        value: {
          security: { passkeys: true },
          sessions: { enabled: true },
        },
      }),
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account/config'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      config: {
        security: { passkeys: true },
        sessions: { enabled: true },
      },
    });
  });

  test('profile update drops sensitive account fields before calling GoTrue', async () => {
    const app = new Elysia().use(routes({
      getAccount: async (token) => {
        expect(token).toBe('user-access-token');
        return { ok: true, user: { id: 'user-1' } };
      },
      updateProfile: async (token, data) => {
        expect(token).toBe('user-access-token');
        expect(data).toEqual({ name: 'Safe Name' });
        return { ok: true, user: { id: 'user-1', user_metadata: data } };
      },
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account/profile', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer user-access-token',
      },
      body: JSON.stringify({
        data: {
          name: 'Safe Name',
          email: 'attacker@example.test',
          role: 'admin',
          app_metadata: 'blocked',
          nested: { ignored: true },
        },
      }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      user: { id: 'user-1', user_metadata: { name: 'Safe Name' } },
    });
  });

  test('account center config disables direct self-service API calls', async () => {
    const disabledConfig = sanitizeAccountCenterConfig({
      enabled: true,
      value: {
        profile: { edit_mode: 'read_only', fields: ['name', 'email'] },
        security: {
          email_change: false,
          phone_change: false,
          mfa: false,
          passkeys: false,
        },
        sessions: { enabled: false },
        grants: { enabled: false },
        identities: { enabled: false },
        delete_account: { enabled: false },
      },
    });
    const forbiddenCalls: string[] = [];
    const app = new Elysia().use(routes({
      getConfig: async () => disabledConfig,
      getAccount: async () => ({ ok: true, user: { id: 'user-1' } }),
      updateContact: async () => {
        forbiddenCalls.push('updateContact');
        return { ok: true, user: { id: 'user-1' } };
      },
      deleteAccount: async () => {
        forbiddenCalls.push('deleteAccount');
        return { deleted: true };
      },
    }));

    const emailResponse = await app.handle(new Request('http://localhost/v1/public/account/email', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer user-access-token',
      },
      body: JSON.stringify({ email: 'new@example.test' }),
    }));
    const deleteResponse = await app.handle(new Request('http://localhost/v1/public/account', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer user-access-token',
      },
      body: JSON.stringify({ confirmation: 'DELETE' }),
    }));

    expect(emailResponse.status).toBe(403);
    expect(await emailResponse.json()).toEqual({
      success: false,
      error: {
        code: 'email_change_disabled',
        message: 'Email change is disabled for this account center.',
      },
    });
    expect(deleteResponse.status).toBe(403);
    expect(await deleteResponse.json()).toEqual({
      success: false,
      error: {
        code: 'delete_account_disabled',
        message: 'Account deletion is disabled for this account center.',
      },
    });
    expect(forbiddenCalls).toEqual([]);
  });

  test('email and phone routes resolve current user before using the user token', async () => {
    const updates: Array<{ token: string; data: Record<string, string> }> = [];
    const app = new Elysia().use(routes({
      getAccount: async (token) => {
        expect(token).toBe('user-access-token');
        return { ok: true, user: { id: 'user-1' } };
      },
      updateContact: async (token, data) => {
        updates.push({ token, data });
        return { ok: true, user: { id: 'user-1', ...data } };
      },
      auditEvent: async () => {},
    }));

    const emailResponse = await app.handle(new Request('http://localhost/v1/public/account/email', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer user-access-token',
      },
      body: JSON.stringify({ email: 'NEW@EXAMPLE.TEST' }),
    }));
    const phoneResponse = await app.handle(new Request('http://localhost/v1/public/account/phone', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer user-access-token',
      },
      body: JSON.stringify({ phone: '+15551234567' }),
    }));

    expect(emailResponse.status).toBe(200);
    expect(phoneResponse.status).toBe(200);
    expect(updates).toEqual([
      { token: 'user-access-token', data: { email: 'new@example.test' } },
      { token: 'user-access-token', data: { phone: '+15551234567' } },
    ]);
  });

  test('lists sessions after resolving the current user from bearer token', async () => {
    const app = new Elysia().use(routes({
      getAccount: async (token) => {
        expect(token).toBe('user-access-token');
        return { ok: true, user: { id: 'user-1' } };
      },
      listSessions: async (userId) => {
        expect(userId).toBe('user-1');
        return { items: [{ id: 'session-1', device: 'Chrome' }], total: 1 };
      },
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account/sessions', {
      headers: { Authorization: 'Bearer user-access-token' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      items: [{ id: 'session-1', device: 'Chrome' }],
      total: 1,
    });
  });

  test('revokes sessions only for the resolved current user', async () => {
    const app = new Elysia().use(routes({
      getAccount: async () => ({ ok: true, user: { id: 'user-1' } }),
      revokeSession: async (userId, sessionId) => {
        expect(userId).toBe('user-1');
        expect(sessionId).toBe('session-1');
        return { revoked: true };
      },
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account/sessions/session-1/revoke', {
      method: 'POST',
      headers: { Authorization: 'Bearer user-access-token' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, result: { revoked: true } });
  });

  test('lists grants for the resolved current user', async () => {
    const app = new Elysia().use(routes({
      getAccount: async () => ({ ok: true, user: { id: 'user-1' } }),
      listGrants: async (userId) => {
        expect(userId).toBe('user-1');
        return { items: [{ id: 'grant-1', applicationId: 'app-1' }], total: 1 };
      },
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account/grants', {
      headers: { Authorization: 'Bearer user-access-token' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      items: [{ id: 'grant-1', applicationId: 'app-1' }],
      total: 1,
    });
  });

  test('does not revoke a grant that is not owned by the current user', async () => {
    const app = new Elysia().use(routes({
      getAccount: async () => ({ ok: true, user: { id: 'user-1' } }),
      revokeGrant: async (userId, consentId) => {
        expect(userId).toBe('user-1');
        expect(consentId).toBe('grant-2');
        return {
          ok: false,
          status: 404,
          code: 'grant_not_found',
          message: 'Grant was not found for the current account.',
        };
      },
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account/grants/grant-2', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer user-access-token' },
    }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      success: false,
      error: {
        code: 'grant_not_found',
        message: 'Grant was not found for the current account.',
      },
    });
  });

  test('lists identities from the resolved GoTrue account payload', async () => {
    const app = new Elysia().use(routes({
      getAccount: async () => ({
        ok: true,
        user: {
          id: 'user-1',
          identities: [{ id: 'identity-1', provider: 'email' }],
        },
      }),
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account/identities', {
      headers: { Authorization: 'Bearer user-access-token' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      items: [{ id: 'identity-1', provider: 'email' }],
      total: 1,
    });
  });

  test('unlinks identities only for the resolved current user', async () => {
    const app = new Elysia().use(routes({
      getAccount: async () => ({ ok: true, user: { id: 'user-1' } }),
      unlinkIdentity: async (userId, identityId) => {
        expect(userId).toBe('user-1');
        expect(identityId).toBe('identity-1');
        return { unlinked: true };
      },
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account/identities/identity-1', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer user-access-token' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, result: { unlinked: true } });
  });

    test('lists and revokes passkeys only for the resolved current user', async () => {
    const calls: string[] = [];
    const app = new Elysia().use(routes({
      getAccount: async () => ({ ok: true, user: { id: 'user-1' } }),
      listPasskeys: async (userId) => {
        calls.push(`list:${userId}`);
        return { items: [{ id: 'passkey-1', name: 'Laptop' }], total: 1 };
      },
      revokePasskey: async (userId, passkeyId) => {
        calls.push(`revoke:${userId}:${passkeyId}`);
        return { revoked: true };
      },
    }));

    const listResponse = await app.handle(new Request('http://localhost/v1/public/account/passkeys', {
      headers: { Authorization: 'Bearer user-access-token' },
    }));
    const revokeResponse = await app.handle(new Request('http://localhost/v1/public/account/passkeys/passkey-1', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer user-access-token' },
    }));

    expect(listResponse.status).toBe(200);
    expect(revokeResponse.status).toBe(200);
    expect(calls).toEqual(['list:user-1', 'revoke:user-1:passkey-1']);
    });

    test('enrolls and verifies TOTP MFA only with the current user token', async () => {
      const events: string[] = [];
      const app = new Elysia().use(routes({
        getAccount: async (token) => {
          expect(token).toBe('user-access-token');
          return { ok: true, user: { id: 'user-1' } };
        },
        enrollTotpMfa: async (token, input) => {
          events.push(`enroll:${token}:${input.friendly_name}:${input.issuer}`);
          return {
            ok: true,
            data: {
              factor_id: 'factor-1',
              id: 'factor-1',
              type: 'totp',
              status: 'unverified',
              friendly_name: input.friendly_name,
              totp: { qr_code: 'data:image/svg+xml;base64,abc', uri: 'otpauth://totp/SupAuth:user@example.test' },
            },
          };
        },
        verifyTotpMfa: async (token, factorId, input) => {
          events.push(`verify:${token}:${factorId}:${input.code}:${input.challengeId || ''}`);
          return { ok: true, data: { id: factorId, status: 'verified' } };
        },
        unenrollMfa: async (token, factorId) => {
          events.push(`unenroll:${token}:${factorId}`);
          return { ok: true, data: { id: factorId, status: 'unenrolled' } };
        },
        auditEvent: async (eventType, userId, details) => {
          events.push(`audit:${eventType}:${userId}:${details?.factor_id || ''}`);
        },
      }));

      const enrollResponse = await app.handle(new Request('http://localhost/v1/public/account/mfa/totp/enroll', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer user-access-token',
        },
        body: JSON.stringify({ friendly_name: 'Phone', issuer: 'SupAuth' }),
      }));
      const verifyResponse = await app.handle(new Request('http://localhost/v1/public/account/mfa/factor-1/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer user-access-token',
        },
        body: JSON.stringify({ code: '123456', challenge_id: 'challenge-1' }),
      }));
      const unenrollResponse = await app.handle(new Request('http://localhost/v1/public/account/mfa/factor-1', {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer user-access-token',
        },
      }));

      expect(enrollResponse.status).toBe(200);
      expect(verifyResponse.status).toBe(200);
      expect(unenrollResponse.status).toBe(200);
      expect(await enrollResponse.json()).toMatchObject({
        success: true,
        enrollment: { factor_id: 'factor-1', totp: { qr_code: 'data:image/svg+xml;base64,abc' } },
      });
      expect(await verifyResponse.json()).toEqual({
        success: true,
        result: { id: 'factor-1', status: 'verified' },
        status: 'verified',
      });
      expect(await unenrollResponse.json()).toEqual({
        success: true,
        result: { id: 'factor-1', status: 'unenrolled' },
        status: 'unenrolled',
      });
      expect(events).toEqual([
        'enroll:user-access-token:Phone:SupAuth',
        'audit:my_account.mfa.totp.enrolled:user-1:factor-1',
        'verify:user-access-token:factor-1:123456:challenge-1',
        'audit:my_account.mfa.totp.verified:user-1:factor-1',
        'unenroll:user-access-token:factor-1',
        'audit:my_account.mfa.unenrolled:user-1:factor-1',
      ]);
    });

    test('rejects TOTP MFA actions when account-center MFA is disabled', async () => {
      const disabledConfig = sanitizeAccountCenterConfig({
        value: { security: { mfa: false } },
      });
      const forbiddenCalls: string[] = [];
      const app = new Elysia().use(routes({
        getConfig: async () => disabledConfig,
        getAccount: async () => ({ ok: true, user: { id: 'user-1' } }),
        enrollTotpMfa: async () => {
          forbiddenCalls.push('enroll');
          return { ok: true, data: {} };
        },
        verifyTotpMfa: async () => {
          forbiddenCalls.push('verify');
          return { ok: true, data: {} };
        },
        unenrollMfa: async () => {
          forbiddenCalls.push('unenroll');
          return { ok: true, data: {} };
        },
      }));

      const enrollResponse = await app.handle(new Request('http://localhost/v1/public/account/mfa/totp/enroll', {
        method: 'POST',
        headers: { Authorization: 'Bearer user-access-token' },
      }));
      const verifyResponse = await app.handle(new Request('http://localhost/v1/public/account/mfa/factor-1/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer user-access-token',
        },
        body: JSON.stringify({ code: '123456' }),
      }));
      const unenrollResponse = await app.handle(new Request('http://localhost/v1/public/account/mfa/factor-1', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer user-access-token' },
      }));

      expect(enrollResponse.status).toBe(403);
      expect(verifyResponse.status).toBe(403);
      expect(unenrollResponse.status).toBe(403);
      expect(await enrollResponse.json()).toEqual({
        success: false,
        error: { code: 'mfa_disabled', message: 'MFA management is disabled for this account center.' },
      });
      expect(await verifyResponse.json()).toEqual({
        success: false,
        error: { code: 'mfa_disabled', message: 'MFA management is disabled for this account center.' },
      });
      expect(await unenrollResponse.json()).toEqual({
        success: false,
        error: { code: 'mfa_disabled', message: 'MFA management is disabled for this account center.' },
      });
      expect(forbiddenCalls).toEqual([]);
    });

  test('delete account requires explicit confirmation and deletes only current user', async () => {
    const deleted: string[] = [];
    const app = new Elysia().use(routes({
      getAccount: async () => ({ ok: true, user: { id: 'user-1' } }),
      deleteAccount: async (userId) => {
        deleted.push(userId);
        return { deleted: true };
      },
    }));

    const rejected = await app.handle(new Request('http://localhost/v1/public/account', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer user-access-token',
      },
      body: JSON.stringify({ confirmation: 'user-2' }),
    }));
    const accepted = await app.handle(new Request('http://localhost/v1/public/account', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer user-access-token',
      },
      body: JSON.stringify({ confirmation: 'DELETE' }),
    }));

    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({
      success: false,
      error: {
        code: 'delete_confirmation_required',
        message: 'Type DELETE to confirm account deletion.',
      },
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ success: true, result: { deleted: true }, status: 'deleted' });
    expect(deleted).toEqual(['user-1']);
  });
});
