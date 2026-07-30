import { describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { observabilityMiddleware } from '../middleware/index.js';
import {
  authorizeIdentityLinkWithGoTrue,
  createPublicAccountRoutes,
  enrollTotpMfaWithGoTrue,
  getAccountWithGoTrue,
  listOAuthGrantsWithGoTrue,
  logoutWithGoTrue,
  revokeOAuthGrantWithGoTrue,
  resolveProviderLinkingCapability,
  sanitizeAccountCenterConfig,
  type ProviderLinkingCapability,
  unenrollMfaFactorWithGoTrue,
  unlinkIdentityWithGoTrue,
  updateAccountContactWithGoTrue,
  updateAccountProfileWithGoTrue,
  verifyTotpMfaWithGoTrue,
} from '../routes/account-self-service.js';
import { SupaCloudApiError } from '../supacloud/adapter.js';

const disabledProviderLinkingCapability = resolveProviderLinkingCapability({}, 'https://auth.example.test');
const enabledProviderLinkingCapability = resolveProviderLinkingCapability({
  manual_linking_enabled: true,
  external_email_enabled: true,
  external_github_enabled: true,
  external_google_enabled: true,
}, 'https://auth.example.test');

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
    grants: { enabled: true },
    identities: { enabled: true },
    delete_account: { enabled: true },
  },
});

function routes(options: Parameters<typeof createPublicAccountRoutes>[0] = {}) {
  return createPublicAccountRoutes({
    getConfig: async () => permissiveAccountCenterConfig,
    getProviderLinkingCapability: async () => disabledProviderLinkingCapability,
    ...options,
  });
}

function testAccessToken(claims: Record<string, unknown> = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'user-1', ...claims })).toString('base64url');
  return `${header}.${payload}.signature`;
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

  test('falls back to raw GoTrue user endpoint when internal auth/v1 route is unavailable', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url));
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer user-access-token' });
      if (String(url) === 'http://127.0.0.1:9999/auth/v1/user') {
        return Response.json({ error: 'not_found' }, { status: 404 });
      }
      return Response.json({
        id: 'user-1',
        email: 'user@example.test',
        role: 'authenticated',
        user_metadata: {},
      });
    };

    const result = await getAccountWithGoTrue('user-access-token', {
      fetchImpl: fetchImpl as typeof fetch,
      runtimeBaseUrls: ['http://127.0.0.1:9999'],
    });

    expect(result).toMatchObject({
      ok: true,
      user: {
        id: 'user-1',
        email: 'user@example.test',
      },
    });
    expect(calls).toEqual([
      'http://127.0.0.1:9999/auth/v1/user',
      'http://127.0.0.1:9999/user',
    ]);
  });

  test('does not fall back to a raw public GoTrue user endpoint after an invalid token response', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url));
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer invalid-token' });
      return Response.json({ code: 'bad_jwt', message: 'invalid token' }, { status: 403 });
    };

    const result = await getAccountWithGoTrue('invalid-token', {
      fetchImpl: fetchImpl as typeof fetch,
      runtimeBaseUrls: ['https://auth.example.test'],
    });

    expect(result).toMatchObject({
      ok: false,
      status: 401,
      code: 'invalid_token',
    });
    expect(calls).toEqual(['https://auth.example.test/auth/v1/user']);
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

  test('lists OAuth grants through the stock GoTrue current-user endpoint', async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('authorization'),
      });
      return Response.json([{ client: { id: 'client-1', name: 'Client One' }, scopes: ['openid'] }]);
    };

    const result = await listOAuthGrantsWithGoTrue('user-access-token', {
      fetchImpl: fetchImpl as typeof fetch,
      runtimeBaseUrls: ['https://auth.example.test'],
    });

    expect(result).toEqual({
      ok: true,
      items: [{ client: { id: 'client-1', name: 'Client One' }, scopes: ['openid'] }],
      total: 1,
    });
    expect(calls).toEqual([{
      url: 'https://auth.example.test/auth/v1/user/oauth/grants',
      authorization: 'Bearer user-access-token',
    }]);
  });

  test('revokes OAuth grants and unlinks identities through stock GoTrue paths', async () => {
    const calls: Array<{ url: string; method: string; authorization: string | null }> = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method || 'GET',
        authorization: new Headers(init?.headers).get('authorization'),
      });
      return String(input).includes('/identities/')
        ? Response.json({})
        : new Response(null, { status: 204 });
    };
    const options = {
      fetchImpl: fetchImpl as typeof fetch,
      runtimeBaseUrls: ['https://auth.example.test'],
    };

    const revoked = await revokeOAuthGrantWithGoTrue('user-access-token', 'client/one', options);
    const unlinked = await unlinkIdentityWithGoTrue('user-access-token', 'identity/one', options);

    expect(revoked).toEqual({ ok: true, data: { client_id: 'client/one', status: 'revoked' } });
    expect(unlinked).toEqual({ ok: true, data: {} });
    expect(calls.map(({ url, method, authorization }) => [url, method, authorization])).toEqual([
      ['https://auth.example.test/auth/v1/user/oauth/grants?client_id=client%2Fone', 'DELETE', 'Bearer user-access-token'],
      ['https://auth.example.test/auth/v1/user/identities/identity%2Fone', 'DELETE', 'Bearer user-access-token'],
    ]);
  });

  test('keeps manual linking separate from v2.193 automatic provider linking domains', () => {
    expect(resolveProviderLinkingCapability({
      manual_linking_enabled: false,
      external_github_enabled: true,
      experimental: { provider_linking_domains: { github: 'social' } },
    }, 'https://auth.example.test')).toEqual(disabledProviderLinkingCapability);

    expect(resolveProviderLinkingCapability({
      manual_linking_enabled: true,
      external_email_enabled: true,
      external_github_enabled: true,
      external_google_enabled: false,
      experimental: { provider_linking_domains: {} },
    }, 'https://auth.example.test')).toEqual({
      available: true,
      source: 'gotrue',
      version: null,
      reason_code: null,
      providers: ['github'],
      redirect_to: 'https://auth.example.test/account',
    });
  });

  test('starts identity linking through the stock GoTrue authorize contract', async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: new URL(String(input)), init });
      return Response.json({ url: 'https://github.com/login/oauth/authorize?state=flow-state' });
    };

    const authorization = await authorizeIdentityLinkWithGoTrue('user-access-token', {
      provider: 'github',
      redirectTo: 'https://auth.example.test/account',
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      runtimeBaseUrls: ['https://auth.example.test'],
    });

    expect(authorization).toEqual({
      ok: true,
      data: {
        provider: 'github',
        url: 'https://github.com/login/oauth/authorize?state=flow-state',
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe('/auth/v1/user/identities/authorize');
    expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({
      provider: 'github',
      redirect_to: 'https://auth.example.test/account',
      skip_http_redirect: 'true',
    });
    expect(calls[0].init).toMatchObject({ method: 'GET', redirect: 'manual' });
    expect(new Headers(calls[0].init?.headers).get('authorization')).toBe('Bearer user-access-token');
  });

  test('logs out only through the requested stock GoTrue scope', async () => {
    const urls: string[] = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      urls.push(String(input));
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer user-access-token');
      return new Response(null, { status: 204 });
    };

    for (const scope of ['local', 'global', 'others'] as const) {
      await expect(logoutWithGoTrue('user-access-token', scope, {
        fetchImpl: fetchImpl as typeof fetch,
        runtimeBaseUrls: ['https://auth.example.test'],
      })).resolves.toEqual({ ok: true, data: { scope, status: 'logged_out' } });
    }
    expect(urls).toEqual([
      'https://auth.example.test/auth/v1/logout?scope=local',
      'https://auth.example.test/auth/v1/logout?scope=global',
      'https://auth.example.test/auth/v1/logout?scope=others',
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
        sessions: { enabled: true, secret: 'ignored' },
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
        email_change: true,
        phone_change: true,
      },
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

  test('resolves permissions only for the requested application context', async () => {
    const app = new Elysia().use(routes({
      getAccount: async () => ({ ok: true, user: { id: 'user-1', email: 'user@example.test' } }),
      resolvePermissions: async (userId, orgId, applicationId) => {
        expect(userId).toBe('user-1');
        expect(orgId).toBe('org-one');
        expect(applicationId).toBe('fa-app');
        return { roles: ['fa_engineer'], permissions: ['fa.rework.approve'], scopes: [] };
      },
    }));

    const response = await app.handle(new Request(
      'http://localhost/v1/public/account/permissions?application_id=fa-app&org_id=org-one&user_id=user-2',
      { headers: { Authorization: `Bearer ${testAccessToken()}` } },
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      application_id: 'fa-app',
      roles: ['fa_engineer'],
      permissions: ['fa.rework.approve'],
      scopes: [],
    });
  });

  test('rejects public permission resolution without an application context', async () => {
    const app = new Elysia().use(routes({
      getAccount: async () => ({ ok: true, user: { id: 'user-1' } }),
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account/permissions', {
      headers: { Authorization: 'Bearer user-access-token' },
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: { code: 'application_id_required', message: 'A valid application_id is required.' },
    });
  });

  test('rejects a query for a different OAuth client before permission resolution', async () => {
    const resolvePermissions = mock(async () => ({ permissions: ['unexpected'] }));
    const app = new Elysia().use(routes({
      getAccount: async () => ({ ok: true, user: { id: 'user-1' } }),
      resolvePermissions,
    }));

    const response = await app.handle(new Request(
      'http://localhost/v1/public/account/permissions?application_id=app-b',
      { headers: { Authorization: `Bearer ${testAccessToken({ client_id: 'app-a' })}` } },
    ));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      error: {
        code: 'application_context_mismatch',
        message: 'The access token is bound to a different application.',
      },
    });
    expect(resolvePermissions).not.toHaveBeenCalled();
  });

  test('fails closed when a verified account is paired with a malformed access token', async () => {
    const resolvePermissions = mock(async () => ({ permissions: ['unexpected'] }));
    const app = new Elysia().use(routes({
      getAccount: async () => ({ ok: true, user: { id: 'user-1' } }),
      resolvePermissions,
    }));

    const response = await app.handle(new Request(
      'http://localhost/v1/public/account/permissions?application_id=app-a',
      { headers: { Authorization: 'Bearer opaque-token' } },
    ));

    expect(response.status).toBe(401);
    expect((await response.json() as any).error.code).toBe('invalid_token');
    expect(resolvePermissions).not.toHaveBeenCalled();
  });

  test('preserves SupaCloud permission lookup failures', async () => {
    const app = new Elysia()
      .use(observabilityMiddleware)
      .use(routes({
        getAccount: async () => ({ ok: true, user: { id: 'user-1' } }),
        resolvePermissions: async () => {
          throw new SupaCloudApiError(503, 'rbac unavailable', '/rbac/permissions');
        },
      }));

    const response = await app.handle(new Request(
      'http://localhost/v1/public/account/permissions?application_id=app-a',
      { headers: { Authorization: `Bearer ${testAccessToken()}` } },
    ));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      success: false,
      error: { code: 'supacloud_upstream_error' },
    });
  });

  test('public config route does not require a token', async () => {
    const app = new Elysia().use(routes({
      getConfig: async () => sanitizeAccountCenterConfig({
        value: { sessions: { enabled: true } },
      }),
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account/config'));

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      config: { security: Record<string, unknown> };
      capabilities: { provider_linking: ProviderLinkingCapability };
    };
    expect(payload).toMatchObject({ success: true });
    expect(payload.config).not.toHaveProperty('sessions');
    expect(payload.config.security).not.toHaveProperty('passkeys');
    expect(payload.capabilities.provider_linking).toEqual(disabledProviderLinkingCapability);
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
      getProviderLinkingCapability: async () => enabledProviderLinkingCapability,
      authorizeIdentityLink: async () => {
        forbiddenCalls.push('authorizeIdentityLink');
        return { ok: true, data: {} };
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
    const identityLinkResponse = await app.handle(new Request(
      'http://localhost/v1/public/account/identities/authorize',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer user-access-token',
        },
        body: JSON.stringify({
          provider: 'github',
          redirect_to: 'https://auth.example.test/account',
        }),
      },
    ));

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
    expect(identityLinkResponse.status).toBe(403);
    expect(await identityLinkResponse.json()).toEqual({
      success: false,
      error: {
        code: 'identities_disabled',
        message: 'Identity management is disabled for this account center.',
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

  test('keeps session list and per-session revoke compatibility routes unavailable', async () => {
    const app = new Elysia().use(routes());
    const listResponse = await app.handle(new Request('http://localhost/v1/public/account/sessions'));
    const revokeResponse = await app.handle(new Request(
      'http://localhost/v1/public/account/sessions/session-1/revoke',
      { method: 'POST' },
    ));

    expect(listResponse.status).toBe(501);
    expect(revokeResponse.status).toBe(501);
  });

  test('lists grants with the original current-user bearer token', async () => {
    const app = new Elysia().use(routes({
      getAccount: async () => ({ ok: true, user: { id: 'user-1' } }),
      listGrants: async (accessToken) => {
        expect(accessToken).toBe('user-access-token');
        return { ok: true, items: [{ client: { id: 'client-1' } }], total: 1 };
      },
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account/grants', {
      headers: { Authorization: 'Bearer user-access-token' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      items: [{ client: { id: 'client-1' } }],
      total: 1,
    });
  });

  test('does not revoke a grant that is not owned by the current user', async () => {
    const app = new Elysia().use(routes({
      getAccount: async () => ({ ok: true, user: { id: 'user-1' } }),
      revokeGrant: async (accessToken, clientId) => {
        expect(accessToken).toBe('user-access-token');
        expect(clientId).toBe('client-2');
        return {
          ok: false,
          status: 404,
          code: 'grant_not_found',
          message: 'Grant was not found for the current account.',
        };
      },
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account/grants/client-2', {
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

  test('fails closed when GoTrue manual linking is not explicitly enabled', async () => {
    const authorizeCalls: unknown[] = [];
    const app = new Elysia().use(routes({
      getAccount: async () => ({ ok: true, user: { id: 'user-1' } }),
      authorizeIdentityLink: async (...args) => {
        authorizeCalls.push(args);
        return { ok: true, data: {} };
      },
    }));

    const response = await app.handle(new Request(
      'http://localhost/v1/public/account/identities/authorize',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer user-access-token',
        },
        body: JSON.stringify({
          provider: 'github',
          redirect_to: 'https://auth.example.test/account',
        }),
      },
    ));

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({
      success: false,
      error: {
        code: 'capability_unavailable',
        message: 'Manual provider linking is not enabled in GoTrue.',
        reason_code: 'manual_linking_disabled',
      },
    });
    expect(authorizeCalls).toEqual([]);
  });

  test('rejects unconfigured providers and off-account redirects before calling GoTrue', async () => {
    const authorizeCalls: unknown[] = [];
    const app = new Elysia().use(routes({
      getAccount: async () => ({ ok: true, user: { id: 'user-1' } }),
      getProviderLinkingCapability: async () => enabledProviderLinkingCapability,
      authorizeIdentityLink: async (...args) => {
        authorizeCalls.push(args);
        return { ok: true, data: {} };
      },
    }));
    const sendLinkRequest = (body: Record<string, string>) => app.handle(new Request(
      'http://localhost/v1/public/account/identities/authorize',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer user-access-token',
        },
        body: JSON.stringify(body),
      },
    ));

    const providerResponse = await sendLinkRequest({
      provider: 'gitlab',
      redirect_to: 'https://auth.example.test/account',
    });
    const redirectResponse = await sendLinkRequest({
      provider: 'github',
      redirect_to: 'https://attacker.example/account',
    });

    expect(providerResponse.status).toBe(400);
    expect(await providerResponse.json()).toEqual({
      success: false,
      error: {
        code: 'provider_not_allowed',
        message: 'Provider is not enabled for manual identity linking.',
      },
    });
    expect(redirectResponse.status).toBe(400);
    expect(await redirectResponse.json()).toEqual({
      success: false,
      error: {
        code: 'invalid_redirect_to',
        message: 'redirect_to must target this account center.',
      },
    });
    expect(authorizeCalls).toEqual([]);
  });

  test('forwards an allowlisted identity linking request with the current user token', async () => {
    const calls: unknown[] = [];
    const app = new Elysia().use(routes({
      getAccount: async (accessToken) => ({ ok: true, user: { id: `user-for-${accessToken}` } }),
      getProviderLinkingCapability: async () => enabledProviderLinkingCapability,
      authorizeIdentityLink: async (accessToken, request) => {
        calls.push({ accessToken, request });
        return {
          ok: true,
          data: {
            provider: request.provider,
            url: 'https://github.com/login/oauth/authorize?state=flow-state',
          },
        };
      },
    }));

    const response = await app.handle(new Request(
      'http://localhost/v1/public/account/identities/authorize',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer user-access-token',
        },
        body: JSON.stringify({
          provider: 'github',
          redirect_to: 'https://auth.example.test/account',
        }),
      },
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      authorization: {
        provider: 'github',
        url: 'https://github.com/login/oauth/authorize?state=flow-state',
      },
    });
    expect(calls).toEqual([{
      accessToken: 'user-access-token',
      request: { provider: 'github', redirectTo: 'https://auth.example.test/account' },
    }]);
  });

  test('unlinks identities with the original current-user bearer token', async () => {
    const app = new Elysia().use(routes({
      getAccount: async () => ({ ok: true, user: { id: 'user-1' } }),
      unlinkIdentity: async (accessToken, identityId) => {
        expect(accessToken).toBe('user-access-token');
        expect(identityId).toBe('identity-1');
        return { ok: true, data: { unlinked: true } };
      },
      auditEvent: async () => {},
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account/identities/identity-1', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer user-access-token' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, result: { unlinked: true } });
  });

  test('accepts only explicit GoTrue logout scopes and forwards the bearer token', async () => {
    const events: string[] = [];
    const app = new Elysia().use(routes({
      getAccount: async (accessToken) => ({ ok: true, user: { id: `user-for-${accessToken}` } }),
      logout: async (accessToken, scope) => {
        events.push(`logout:${accessToken}:${scope}`);
        return { ok: true, data: { scope, status: 'logged_out' } };
      },
      auditEvent: async (eventType, userId, details) => {
        events.push(`audit:${eventType}:${userId}:${details?.scope}`);
      },
    }));

    const validResponse = await app.handle(new Request(
      'http://localhost/v1/public/account/logout?scope=others',
      { method: 'POST', headers: { Authorization: 'Bearer user-access-token' } },
    ));
    const invalidResponse = await app.handle(new Request(
      'http://localhost/v1/public/account/logout?scope=session-1',
      { method: 'POST', headers: { Authorization: 'Bearer user-access-token' } },
    ));

    expect(validResponse.status).toBe(200);
    expect(await validResponse.json()).toEqual({
      success: true,
      result: { scope: 'others', status: 'logged_out' },
    });
    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toEqual({
      success: false,
      error: {
        code: 'invalid_logout_scope',
        message: 'Logout scope must be local, global, or others.',
      },
    });
    expect(events).toEqual([
      'logout:user-access-token:others',
      'audit:my_account.logged_out:user-for-user-access-token:others',
    ]);
  });

  test('does not swallow account audit failures', async () => {
    const app = new Elysia().use(routes({
      getAccount: async () => ({ ok: true, user: { id: 'user-1' } }),
      unlinkIdentity: async () => ({ ok: true, data: {} }),
      auditEvent: async () => {
        throw new Error('audit unavailable');
      },
    }));

    const response = await app.handle(new Request(
      'http://localhost/v1/public/account/identities/identity-1',
      { method: 'DELETE', headers: { Authorization: 'Bearer user-access-token' } },
    ));

    expect(response.status).toBe(500);
  });

    test('keeps removed passkey management routes unavailable', async () => {
    const app = new Elysia().use(routes({
      getAccount: async () => ({ ok: true, user: { id: 'user-1' } }),
    }));

    const listResponse = await app.handle(new Request('http://localhost/v1/public/account/passkeys', {
      headers: { Authorization: 'Bearer user-access-token' },
    }));
    const revokeResponse = await app.handle(new Request('http://localhost/v1/public/account/passkeys/passkey-1', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer user-access-token' },
    }));

    expect(listResponse.status).toBe(501);
    expect(revokeResponse.status).toBe(501);
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
              totp: {
                qr_code: 'data:image/svg+xml;base64,abc',
                uri: 'otpauth://totp/SupAuth:user@example.test',
                secret: 'RAW-TOTP-SECRET',
              },
            },
          };
        },
        verifyTotpMfa: async (token, factorId, input) => {
          events.push(`verify:${token}:${factorId}:${input.code}:${input.challengeId || ''}`);
          return {
            ok: true,
            data: {
              id: factorId,
              status: 'verified',
              access_token: 'aal2-access-token',
              refresh_token: 'aal2-refresh-token',
            },
          };
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
      const resetResponse = await app.handle(new Request('http://localhost/v1/public/account/mfa/factor-1/reset', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer user-access-token',
        },
      }));

      expect(enrollResponse.status).toBe(200);
      expect(verifyResponse.status).toBe(200);
      expect(unenrollResponse.status).toBe(200);
      expect(resetResponse.status).toBe(404);
      const enrollBody = await enrollResponse.json();
      expect(enrollBody).toMatchObject({
        success: true,
        enrollment: { factor_id: 'factor-1', totp: { qr_code: 'data:image/svg+xml;base64,abc' } },
      });
      expect(JSON.stringify(enrollBody)).not.toContain('RAW-TOTP-SECRET');
      expect(JSON.stringify(enrollBody)).not.toContain('"secret"');
      expect(await verifyResponse.json()).toEqual({
        success: true,
        result: { id: 'factor-1', status: 'verified' },
        session: { access_token: 'aal2-access-token', refresh_token: 'aal2-refresh-token' },
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

    test('fails closed when GoTrue verification does not return an upgraded session', async () => {
      let audited = false;
      const app = new Elysia().use(routes({
        getConfig: async () => sanitizeAccountCenterConfig({ value: { security: { mfa: true } } }),
        getAccount: async () => ({ ok: true, user: { id: 'user-1' } }),
        verifyTotpMfa: async () => ({ ok: true, data: { id: 'factor-1', status: 'verified' } }),
        auditEvent: async () => { audited = true; },
      }));

      const response = await app.handle(new Request('http://localhost/v1/public/account/mfa/factor-1/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer user-access-token',
        },
        body: JSON.stringify({ code: '123456' }),
      }));

      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        success: false,
        error: {
          code: 'mfa_session_invalid',
          message: 'Authentication runtime did not return an upgraded MFA session.',
        },
      });
      expect(audited).toBe(false);
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
