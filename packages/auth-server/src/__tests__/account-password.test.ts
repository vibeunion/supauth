import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  changePasswordWithGoTrue,
  createPublicAccountPasswordRoutes,
} from '../routes/account-password.js';
import { sanitizeAccountCenterConfig } from '../routes/account-self-service.js';
import { GOTRUE_PASSWORD_CHARACTER_POLICIES } from '../utils/password-policy.js';

const permissiveAccountCenterConfig = sanitizeAccountCenterConfig({
  enabled: true,
  value: { security: { password_change: true } },
});

const noCharacterRequirements = {
  password_min_length: 6,
  password_required_characters: GOTRUE_PASSWORD_CHARACTER_POLICIES.none,
};

function passwordChangeRequest(email: string, newPassword = 'NewPass123!') {
  return new Request('http://localhost/v1/public/account-password/change', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      current_password: 'OldPass123!',
      new_password: newPassword,
      confirm_password: newPassword,
    }),
  });
}

function responseWithBodyError(error: unknown) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(error);
    },
  }), { status: 200 });
}

function enabledRouteOptions(changePassword: (input: any) => Promise<{ ok: true; userId?: string }>) {
  return {
    changePassword,
    getAccountCenterConfig: async () => permissiveAccountCenterConfig,
    getAuthConfig: async () => noCharacterRequirements,
  };
}

describe('account password self-service', () => {
  test('changes password through GoTrue password grant and user update', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/token?grant_type=password')) {
        return Response.json({
          access_token: 'user-access-token',
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
      auditImpl: async () => {},
    });

    expect(result).toEqual({ ok: true, userId: 'user-1' });
    expect(calls.map(call => call.url)).toEqual([
      'https://auth.example.test/auth/v1/token?grant_type=password',
      'https://auth.example.test/auth/v1/user',
    ]);
  });

  test('does not misclassify or swallow an audit failure after GoTrue updates the password', async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      if (String(url).includes('/token?grant_type=password')) {
        return Response.json({ access_token: 'user-access-token', user: { id: 'user-1' } });
      }
      return Response.json({ id: 'user-1' });
    };

    await expect(changePasswordWithGoTrue({
      email: 'user@example.test',
      currentPassword: 'OldPass123!',
      newPassword: 'NewPass123!',
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      runtimeBaseUrls: ['https://auth.example.test'],
      auditImpl: async () => { throw new Error('audit unavailable'); },
    })).rejects.toThrow('audit unavailable');
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
    const app = new Elysia().use(createPublicAccountPasswordRoutes(enabledRouteOptions(
      async (input) => {
        expect(input).toEqual({
          email: 'user@example.test',
          currentPassword: 'OldPass123!',
          newPassword: 'NewPass123!',
        });
        return { ok: true, userId: 'user-1' };
      },
    )));

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
    const app = new Elysia().use(createPublicAccountPasswordRoutes(
      enabledRouteOptions(async () => ({ ok: true })),
    ));

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

  test('requires both account center and password change feature gates before runtime access', async () => {
    for (const [email, accountCenterConfig] of [
      ['center-disabled@example.test', sanitizeAccountCenterConfig({ enabled: false })],
      ['password-disabled@example.test', sanitizeAccountCenterConfig({
        enabled: true,
        value: { security: { password_change: false } },
      })],
    ] as const) {
      let authConfigReads = 0;
      let passwordChanges = 0;
      const app = new Elysia().use(createPublicAccountPasswordRoutes({
        getAccountCenterConfig: async () => accountCenterConfig,
        getAuthConfig: async () => {
          authConfigReads += 1;
          return noCharacterRequirements;
        },
        changePassword: async () => {
          passwordChanges += 1;
          return { ok: true };
        },
      }));

      const response = await app.handle(passwordChangeRequest(email));

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        success: false,
        error: {
          code: 'password_change_disabled',
          message: 'Password change is disabled for this account center.',
        },
      });
      expect(authConfigReads).toBe(0);
      expect(passwordChanges).toBe(0);
    }
  });

  test('returns a stable 503 when account center configuration cannot be read', async () => {
    let authConfigReads = 0;
    let passwordChanges = 0;
    const app = new Elysia().use(createPublicAccountPasswordRoutes({
      getAccountCenterConfig: async () => { throw new Error('postgres://secret@db.internal:5432'); },
      getAuthConfig: async () => {
        authConfigReads += 1;
        return noCharacterRequirements;
      },
      changePassword: async () => {
        passwordChanges += 1;
        return { ok: true };
      },
    }));

    const response = await app.handle(passwordChangeRequest('config-failure@example.test'));
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body).toEqual({
      success: false,
      error: {
        code: 'account_center_unavailable',
        message: 'Account center configuration is temporarily unavailable.',
      },
    });
    expect(JSON.stringify(body)).not.toContain('db.internal');
    expect(authConfigReads).toBe(0);
    expect(passwordChanges).toBe(0);
  });

  test('keeps the documented enabled defaults when the account center row is missing', async () => {
    let accountCenterReads = 0;
    let authConfigReads = 0;
    let passwordChanges = 0;
    const app = new Elysia().use(createPublicAccountPasswordRoutes({
      getAccountCenterConfig: async () => {
        accountCenterReads += 1;
        return sanitizeAccountCenterConfig({});
      },
      getAuthConfig: async () => {
        authConfigReads += 1;
        return noCharacterRequirements;
      },
      changePassword: async () => {
        passwordChanges += 1;
        return { ok: true };
      },
    }));

    const response = await app.handle(passwordChangeRequest('missing-row@example.test'));

    expect(response.status).toBe(200);
    expect(accountCenterReads).toBe(1);
    expect(authConfigReads).toBe(1);
    expect(passwordChanges).toBe(1);
  });

  test('enforces the authoritative GoTrue password policy before password grant', async () => {
    const cases = [
      {
        email: 'min-length@example.test',
        authConfig: {
          password_min_length: 12,
          password_required_characters: GOTRUE_PASSWORD_CHARACTER_POLICIES.none,
        },
        password: 'Short1!',
        code: 'password_too_short',
      },
      {
        email: 'standard@example.test',
        authConfig: {
          password_min_length: 12,
          password_required_characters: GOTRUE_PASSWORD_CHARACTER_POLICIES.standard,
        },
        password: 'lowercase1234',
        code: 'password_requires_uppercase',
      },
      {
        email: 'strong@example.test',
        authConfig: {
          password_min_length: 12,
          password_required_characters: GOTRUE_PASSWORD_CHARACTER_POLICIES.strong,
        },
        password: 'NoSymbols123A',
        code: 'password_requires_symbol',
      },
    ];

    for (const policyCase of cases) {
      let passwordChanges = 0;
      const app = new Elysia().use(createPublicAccountPasswordRoutes({
        getAccountCenterConfig: async () => permissiveAccountCenterConfig,
        getAuthConfig: async () => policyCase.authConfig,
        changePassword: async () => {
          passwordChanges += 1;
          return { ok: true };
        },
      }));

      const response = await app.handle(passwordChangeRequest(policyCase.email, policyCase.password));
      const body = await response.json() as any;

      expect(response.status).toBe(400);
      expect(body.error.code).toBe(policyCase.code);
      expect(passwordChanges).toBe(0);
    }
  });

  test('fails closed when GoTrue returns an invalid password policy', async () => {
    let passwordChanges = 0;
    const app = new Elysia().use(createPublicAccountPasswordRoutes({
      getAccountCenterConfig: async () => permissiveAccountCenterConfig,
      getAuthConfig: async () => ({
        password_min_length: 12,
        password_required_characters: 'custom-unrepresentable-policy',
      }),
      changePassword: async () => {
        passwordChanges += 1;
        return { ok: true };
      },
    }));

    const response = await app.handle(passwordChangeRequest('invalid-policy@example.test', 'ValidPass12!'));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      success: false,
      error: {
        code: 'password_policy_unavailable',
        message: 'Password policy is temporarily unavailable.',
      },
    });
    expect(passwordChanges).toBe(0);
  });

  test('classifies password grant failures without exposing upstream details', async () => {
    const cases = [
      { status: 400, payload: { msg: 'Invalid login credentials' }, expectedStatus: 400, code: 'invalid_current_password' },
      { status: 400, payload: { message: 'postgres://secret@auth.internal:5432' }, expectedStatus: 400, code: 'password_grant_rejected' },
      { status: 401, payload: { message: 'token secret at auth.internal' }, expectedStatus: 401, code: 'invalid_token' },
      { status: 403, payload: { message: 'policy secret at auth.internal' }, expectedStatus: 403, code: 'upstream_forbidden' },
      { status: 429, payload: { message: 'ratelimit host auth.internal' }, expectedStatus: 429, code: 'upstream_rate_limited' },
      { status: 500, payload: { message: 'database auth.internal password=secret' }, expectedStatus: 502, code: 'runtime_unavailable' },
    ];

    for (const failureCase of cases) {
      const result = await changePasswordWithGoTrue({
        email: 'matrix@example.test',
        currentPassword: 'OldPass123!',
        newPassword: 'NewPass123!',
      }, {
        fetchImpl: (() => Promise.resolve(Response.json(failureCase.payload, { status: failureCase.status }))) as unknown as typeof fetch,
        runtimeBaseUrls: ['https://auth.example.test'],
      });

      expect(result).toMatchObject({
        ok: false,
        status: failureCase.expectedStatus,
        code: failureCase.code,
      });
      expect(JSON.stringify(result)).not.toContain('auth.internal');
      expect(JSON.stringify(result)).not.toContain('secret');
    }
  });

  test('classifies password update weak-password and transport failures safely', async () => {
    const updateCases = [
      { response: Response.json({ code: 'weak_password', message: 'Password is too weak' }, { status: 422 }), status: 400, code: 'weak_password' },
      { response: Response.json({ message: 'private auth.internal detail' }, { status: 404 }), status: 404, code: 'upstream_not_found' },
      { response: Response.json({ message: 'private auth.internal detail' }, { status: 500 }), status: 502, code: 'runtime_unavailable' },
    ];

    for (const updateCase of updateCases) {
      let calls = 0;
      const result = await changePasswordWithGoTrue({
        email: 'update-matrix@example.test',
        currentPassword: 'OldPass123!',
        newPassword: 'NewPass123!',
      }, {
        fetchImpl: (() => {
          calls += 1;
          return Promise.resolve(calls === 1
            ? Response.json({ access_token: 'user-access-token', user: { id: 'user-1' } })
            : updateCase.response.clone());
        }) as unknown as typeof fetch,
        runtimeBaseUrls: ['https://auth.example.test'],
      });

      expect(result).toMatchObject({ ok: false, status: updateCase.status, code: updateCase.code });
      expect(JSON.stringify(result)).not.toContain('auth.internal');
    }

    for (const transportCase of [
      { error: new TypeError('getaddrinfo ENOTFOUND auth.internal?token=secret'), status: 502, code: 'runtime_unavailable' },
      { error: new DOMException('auth.internal timed out', 'TimeoutError'), status: 504, code: 'runtime_timeout' },
    ]) {
      const result = await changePasswordWithGoTrue({
        email: 'transport@example.test',
        currentPassword: 'OldPass123!',
        newPassword: 'NewPass123!',
      }, {
        fetchImpl: (() => Promise.reject(transportCase.error)) as unknown as typeof fetch,
        runtimeBaseUrls: ['https://auth.example.test'],
      });

      expect(result).toMatchObject({ ok: false, status: transportCase.status, code: transportCase.code });
      expect(JSON.stringify(result)).not.toContain('auth.internal');
      expect(JSON.stringify(result)).not.toContain('secret');
    }
  });

  test('classifies grant and update response-body timeouts without reporting success', async () => {
    for (const errorName of ['TimeoutError', 'AbortError']) {
      const grantResult = await changePasswordWithGoTrue({
        email: `grant-body-${errorName.toLowerCase()}@example.test`,
        currentPassword: 'OldPass123!',
        newPassword: 'NewPass123!',
      }, {
        fetchImpl: (async () => responseWithBodyError(new DOMException('private detail', errorName))) as unknown as typeof fetch,
        runtimeBaseUrls: ['https://auth.example.test'],
      });
      expect(grantResult).toMatchObject({ ok: false, status: 504, code: 'runtime_timeout' });
    }

    let updateCalls = 0;
    let auditCalls = 0;
    const updateResult = await changePasswordWithGoTrue({
      email: 'update-body-timeout@example.test',
      currentPassword: 'OldPass123!',
      newPassword: 'NewPass123!',
    }, {
      fetchImpl: (async () => {
        updateCalls += 1;
        return updateCalls === 1
          ? Response.json({ access_token: 'user-access-token' })
          : responseWithBodyError(new DOMException('private detail', 'TimeoutError'));
      }) as unknown as typeof fetch,
      runtimeBaseUrls: ['https://auth.example.test'],
      auditImpl: async () => { auditCalls += 1; },
    });
    expect(updateResult).toMatchObject({ ok: false, status: 504, code: 'runtime_timeout' });
    expect(auditCalls).toBe(0);
  });

  test('retains a timeout when later runtime candidates have ordinary network failures', async () => {
    let calls = 0;
    const result = await changePasswordWithGoTrue({
      email: 'mixed-runtime-failure@example.test',
      currentPassword: 'OldPass123!',
      newPassword: 'NewPass123!',
    }, {
      fetchImpl: (async () => {
        calls += 1;
        if (calls === 1) throw new DOMException('private timeout detail', 'TimeoutError');
        throw new TypeError('private DNS detail');
      }) as unknown as typeof fetch,
      runtimeBaseUrls: ['https://first.example.test', 'https://second.example.test'],
    });
    expect(result).toMatchObject({ ok: false, status: 504, code: 'runtime_timeout' });
    expect(JSON.stringify(result)).not.toContain('private');
  });
});
