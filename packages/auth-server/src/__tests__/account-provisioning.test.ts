import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  createPublicAccountClaimRoutes,
  mergeUserPayload,
  resolveAccountClaimPasswordProjectRef,
  resolveProvisioningInitialPassword,
  sanitizeAccountClaimConfig,
} from '../routes/account-provisioning.js';
import {
  decryptInitialPassword,
  encryptInitialPassword,
  externalIdLookupCandidates,
  hashAccountClaimProof,
  normalizeDisplayName,
  normalizeExternalId,
} from '../repositories/account-provisioning.js';
import {
  GOTRUE_PASSWORD_CHARACTER_POLICIES,
  mergePasswordPolicies,
  passwordPolicyFromAuthConfig,
  passwordPolicyViolation,
} from '../utils/password-policy.js';
import { SupaCloudApiError } from '../supacloud/adapter.js';

const VALID_CLAIM_PROOF = 'claim-proof-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function enabledClaimConfig(value: Record<string, unknown> = {}) {
  return sanitizeAccountClaimConfig({ enabled: true, value });
}

function claimRequestBody(overrides: Record<string, unknown> = {}) {
  return {
    display_name: '张三',
    external_id: '10086',
    external_type: 'employee',
    claim_proof: VALID_CLAIM_PROOF,
    ...overrides,
  };
}

describe('account provisioning and claiming', () => {
  test('normalizes account claim identity fields', () => {
    expect(normalizeDisplayName(' 张 三 ')).toBe('张三');
    expect(normalizeExternalId('  10086  ')).toBe('10086');
    expect(normalizeExternalId('０２６７')).toBe('267');
    expect(externalIdLookupCandidates('0267')).toEqual(['267', '0267']);
    expect(externalIdLookupCandidates('267')).toEqual(['267', '0267']);
  });

  test('encrypts and decrypts initial passwords', () => {
    const secret = 'account-claim-secret-for-test';
    const encrypted = encryptInitialPassword('Abc123!@#', secret);
    expect(encrypted).not.toContain('Abc123');
    expect(decryptInitialPassword(encrypted, secret)).toBe('Abc123!@#');
  });

  test('hashes one-time claim proofs without retaining plaintext', () => {
    const hashed = hashAccountClaimProof(VALID_CLAIM_PROOF);
    expect(hashed).toMatch(/^v1:[A-Za-z0-9_-]{43}$/);
    expect(hashed).not.toContain(VALID_CLAIM_PROOF);
    expect(hashAccountClaimProof(VALID_CLAIM_PROOF)).toBe(hashed);
  });

  test('public claim route returns email and initial password once', async () => {
    const app = new Elysia().use(createPublicAccountClaimRoutes({
      getConfig: async () => enabledClaimConfig(),
      claimAccount: async () => ({
        status: 'claimed',
        email: 'zhangsan@example.com',
        initialPassword: 'Init123!',
      }),
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account-claims/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(claimRequestBody()),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      status: 'claimed',
      email: 'zhangsan@example.com',
      initial_password: 'Init123!',
    });
  });

  test('sanitizes account claim password mode configuration', () => {
    expect(sanitizeAccountClaimConfig({
      enabled: true,
      value: {
        external_type: 'member',
        password: { mode: 'set_on_claim', min_length: 10 },
        phrases: {
          'zh-CN': { submitSetPassword: '领取并设置密码' },
          en: { submitSetPassword: 'Claim and set password' },
          ignored: { nested: { invalid: true } },
        },
      },
    })).toEqual({
      enabled: true,
      external_type: 'member',
      password: {
        mode: 'set_on_claim',
        min_length: 10,
        require_uppercase: false,
        require_lowercase: false,
        require_numbers: false,
        require_symbols: false,
      },
      phrases: {
        'zh-CN': { submitSetPassword: '领取并设置密码' },
        en: { submitSetPassword: 'Claim and set password' },
      },
    });

    expect(sanitizeAccountClaimConfig({ value: { password: { mode: 'unknown', min_length: 2 } } })).toEqual({
      enabled: false,
      external_type: 'employee',
      password: {
        mode: 'show_initial_password',
        min_length: 6,
        require_uppercase: false,
        require_lowercase: false,
        require_numbers: false,
        require_symbols: false,
      },
      phrases: {},
    });
  });

  test('derives only supported public password policies from GoTrue auth config', () => {
    expect(passwordPolicyFromAuthConfig({
      password_min_length: 8,
      password_required_characters: GOTRUE_PASSWORD_CHARACTER_POLICIES.none,
    })).toEqual({
      min_length: 8,
      require_uppercase: false,
      require_lowercase: false,
      require_numbers: false,
      require_symbols: false,
    });

    expect(passwordPolicyFromAuthConfig({
      password_min_length: 10,
      password_required_characters: GOTRUE_PASSWORD_CHARACTER_POLICIES.standard,
    })).toEqual({
      min_length: 10,
      require_uppercase: true,
      require_lowercase: true,
      require_numbers: true,
      require_symbols: false,
    });

    expect(passwordPolicyFromAuthConfig({
      password_min_length: 12,
      password_required_characters: GOTRUE_PASSWORD_CHARACTER_POLICIES.strong,
    }).require_symbols).toBe(true);
    expect(() => passwordPolicyFromAuthConfig({
      password_min_length: 10,
      password_required_characters: 'custom-unrepresentable-policy',
    })).toThrow('unsupported password_required_characters');
    expect(() => passwordPolicyFromAuthConfig({})).toThrow('invalid password_required_characters');
    expect(() => passwordPolicyFromAuthConfig({
      password_required_characters: GOTRUE_PASSWORD_CHARACTER_POLICIES.none,
    })).toThrow('invalid password_min_length');
    expect(() => passwordPolicyFromAuthConfig({
      password_min_length: 10,
    })).toThrow('invalid password_required_characters');
    for (const passwordMinLength of ['12', [12], { value: 12 }]) {
      expect(() => passwordPolicyFromAuthConfig({
        password_min_length: passwordMinLength,
        password_required_characters: GOTRUE_PASSWORD_CHARACTER_POLICIES.none,
      })).toThrow('invalid password_min_length');
    }
  });

  test('merges password policies without weakening any target project', () => {
    expect(mergePasswordPolicies({
      min_length: 12,
      require_uppercase: false,
      require_lowercase: false,
      require_numbers: false,
      require_symbols: false,
    }, {
      min_length: 10,
      require_uppercase: true,
      require_lowercase: true,
      require_numbers: true,
      require_symbols: false,
    })).toEqual({
      min_length: 12,
      require_uppercase: true,
      require_lowercase: true,
      require_numbers: true,
      require_symbols: false,
    });
  });

  test('reports the first unmet password requirement', () => {
    const policy = passwordPolicyFromAuthConfig({
      password_min_length: 10,
      password_required_characters: GOTRUE_PASSWORD_CHARACTER_POLICIES.standard,
    });
    expect(passwordPolicyViolation('12345678', policy)).toBe('password_too_short');
    expect(passwordPolicyViolation('1234567890', policy)).toBe('password_requires_uppercase');
    expect(passwordPolicyViolation('ABCDEFGHI1', policy)).toBe('password_requires_lowercase');
    expect(passwordPolicyViolation('Abcdefghij', policy)).toBe('password_requires_number');
    expect(passwordPolicyViolation('Abcdefgh1j', policy)).toBeNull();

    const strongPolicy = passwordPolicyFromAuthConfig({
      password_min_length: 10,
      password_required_characters: GOTRUE_PASSWORD_CHARACTER_POLICIES.strong,
    });
    expect(passwordPolicyViolation('Abcdefgh1j', strongPolicy)).toBe('password_requires_symbol');
    expect(passwordPolicyViolation('Abcdefgh1!', strongPolicy)).toBeNull();
  });

  test('resolves one authoritative password update project for external hosted auth', () => {
    expect(resolveAccountClaimPasswordProjectRef({
      projectRef: 'business-project',
      oauthAuthorizationProjectRef: 'central-auth-project',
    })).toBe('central-auth-project');

    expect(resolveAccountClaimPasswordProjectRef({
      projectRef: 'same-project',
      oauthAuthorizationProjectRef: 'same-project',
    })).toBe('same-project');
    expect(resolveAccountClaimPasswordProjectRef({
      projectRef: 'business-project',
      oauthAuthorizationProjectRef: '  ',
    })).toBe('business-project');
  });

  test('fails closed without explicit configuration and skips claim and GoTrue calls', async () => {
    let claimCalls = 0;
    let passwordPolicyCalls = 0;
    const app = new Elysia().use(createPublicAccountClaimRoutes({
      getConfig: async () => sanitizeAccountClaimConfig({}),
      getPasswordPolicy: async () => {
        passwordPolicyCalls += 1;
        throw new Error('must not be called');
      },
      claimAccount: async () => {
        claimCalls += 1;
        return { status: 'unavailable' };
      },
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account-claims/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(claimRequestBody()),
    }));

    expect(response.status).toBe(403);
    expect(claimCalls).toBe(0);
    expect(passwordPolicyCalls).toBe(0);
  });

  test('fails closed when configuration lookup fails and skips claim and GoTrue calls', async () => {
    let claimCalls = 0;
    let passwordPolicyCalls = 0;
    const app = new Elysia().use(createPublicAccountClaimRoutes({
      getConfig: async () => { throw new Error('configuration database unavailable'); },
      getPasswordPolicy: async () => {
        passwordPolicyCalls += 1;
        throw new Error('must not be called');
      },
      claimAccount: async () => {
        claimCalls += 1;
        return { status: 'unavailable' };
      },
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account-claims/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(claimRequestBody()),
    }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('account_claim_disabled');
    expect(claimCalls).toBe(0);
    expect(passwordPolicyCalls).toBe(0);
  });

  test('public claim config route exposes sanitized configuration', async () => {
    const app = new Elysia().use(createPublicAccountClaimRoutes({
      getConfig: async () => sanitizeAccountClaimConfig({
        enabled: true,
        value: {
          external_type: 'member',
          password: { mode: 'set_on_claim', min_length: 12 },
        },
      }),
      getPasswordPolicy: async () => ({
        min_length: 10,
        require_uppercase: true,
        require_lowercase: true,
        require_numbers: true,
        require_symbols: false,
      }),
      claimAccount: async () => ({ status: 'unavailable' }),
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account-claims/config'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      config: {
        enabled: true,
        external_type: 'member',
        password: {
          mode: 'set_on_claim',
          min_length: 12,
          require_uppercase: true,
          require_lowercase: true,
          require_numbers: true,
          require_symbols: false,
        },
        phrases: {},
      },
    });
  });

  test('public claim route requires a new password when configured', async () => {
    const app = new Elysia().use(createPublicAccountClaimRoutes({
      getConfig: async () => sanitizeAccountClaimConfig({
        enabled: true,
        value: { password: { mode: 'set_on_claim', min_length: 10 } },
      }),
      claimAccount: async () => ({
        status: 'claimed',
        email: 'zhangsan@example.com',
        passwordSet: true,
      }),
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account-claims/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(claimRequestBody()),
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('password_too_short');
  });

  test('public claim route rejects a numeric password against the live character policy', async () => {
    let claimCalled = false;
    const app = new Elysia().use(createPublicAccountClaimRoutes({
      getConfig: async () => sanitizeAccountClaimConfig({
        enabled: true,
        value: { password: { mode: 'set_on_claim', min_length: 8 } },
      }),
      getPasswordPolicy: async () => ({
        min_length: 10,
        require_uppercase: true,
        require_lowercase: true,
        require_numbers: true,
        require_symbols: false,
      }),
      claimAccount: async () => {
        claimCalled = true;
        return { status: 'unavailable' };
      },
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account-claims/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.0.2.10' },
      body: JSON.stringify(claimRequestBody({
        new_password: '1234567890',
      })),
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('password_requires_uppercase');
    expect(claimCalled).toBe(false);
  });

  test('public claim route maps an authoritative weak-password rejection', async () => {
    const app = new Elysia().use(createPublicAccountClaimRoutes({
      getConfig: async () => sanitizeAccountClaimConfig({
        enabled: true,
        value: { password: { mode: 'set_on_claim', min_length: 8 } },
      }),
      claimAccount: async () => {
        throw new SupaCloudApiError(
          422,
          JSON.stringify({ code: 'weak_password', message: 'Password is too weak' }),
          '/v1/projects/test/auth/users/user-1',
        );
      },
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account-claims/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.0.2.11' },
      body: JSON.stringify(claimRequestBody({
        new_password: 'NewPass123!',
      })),
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('weak_password');
  });

  test('public claim route hides upstream failure details', async () => {
    const app = new Elysia().use(createPublicAccountClaimRoutes({
      getConfig: async () => enabledClaimConfig(),
      claimAccount: async () => {
        throw new Error('connect ECONNREFUSED 10.0.0.8:5432 secret-host');
      },
    }));
    const response = await app.handle(new Request('http://localhost/v1/public/account-claims/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(claimRequestBody()),
    }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toEqual({
      code: 'account_claim_unavailable',
      message: 'Account claiming is temporarily unavailable. Please try again later.',
    });
    expect(JSON.stringify(body)).not.toContain('10.0.0.8');
  });

  test('public claim route can claim by setting a new password instead of returning the initial password', async () => {
    let receivedInput: {
      passwordMode?: string;
      claimProof?: string;
      newPassword?: string;
      updatePassword?: unknown;
    } | undefined;
    const app = new Elysia().use(createPublicAccountClaimRoutes({
      getConfig: async () => sanitizeAccountClaimConfig({
        enabled: true,
        value: { password: { mode: 'set_on_claim', min_length: 8 } },
      }),
      updatePassword: async () => {},
      claimAccount: async (input) => {
        receivedInput = input;
        return {
          status: 'claimed',
          email: 'zhangsan@example.com',
          passwordSet: true,
        };
      },
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account-claims/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(claimRequestBody({
        new_password: 'NewPass123!',
      })),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      status: 'claimed',
      email: 'zhangsan@example.com',
      password_set: true,
    });
    expect(body.initial_password).toBeUndefined();
    expect(receivedInput).toMatchObject({
      passwordMode: 'set_on_claim',
      claimProof: VALID_CLAIM_PROOF,
      newPassword: 'NewPass123!',
    });
    expect(typeof receivedInput?.updatePassword).toBe('function');
    expect(JSON.stringify(body)).not.toContain(VALID_CLAIM_PROOF);
  });

  test('uses one public error for wrong identity, proof, claimed, and unavailable records', async () => {
    for (const body of [
      claimRequestBody({ display_name: '错误姓名' }),
      claimRequestBody({ external_id: 'wrong-id' }),
      claimRequestBody({ claim_proof: 'wrong-proof' }),
      claimRequestBody(),
    ]) {
      const app = new Elysia().use(createPublicAccountClaimRoutes({
        getConfig: async () => enabledClaimConfig(),
        claimAccount: async () => ({ status: 'unavailable' }),
      }));
      const response = await app.handle(new Request('http://localhost/v1/public/account-claims/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }));
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        success: false,
        error: {
          code: 'account_claim_unavailable',
          message: 'Account cannot be claimed with the supplied credentials.',
        },
      });
    }
  });

  test('public claim route rejects repeat claims after a password was set on claim', async () => {
    const app = new Elysia().use(createPublicAccountClaimRoutes({
      getConfig: async () => sanitizeAccountClaimConfig({
        enabled: true,
        value: { password: { mode: 'set_on_claim', min_length: 8 } },
      }),
      claimAccount: async () => ({
        status: 'unavailable',
      }),
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account-claims/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(claimRequestBody({
        new_password: 'NewPass123!',
      })),
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      success: false,
      error: {
        code: 'account_claim_unavailable',
        message: 'Account cannot be claimed with the supplied credentials.',
      },
    });
    expect(body.email).toBeUndefined();
    expect(body.initial_password).toBeUndefined();
    expect(body.password_set).toBeUndefined();
  });

  test('public claim route does not return password after it was claimed', async () => {
    const app = new Elysia().use(createPublicAccountClaimRoutes({
      getConfig: async () => enabledClaimConfig(),
      claimAccount: async () => ({
        status: 'unavailable',
      }),
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account-claims/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(claimRequestBody()),
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      success: false,
      error: {
        code: 'account_claim_unavailable',
        message: 'Account cannot be claimed with the supplied credentials.',
      },
    });
    expect(body.email).toBeUndefined();
    expect(body.initial_password).toBeUndefined();
  });

  test('public claim route rejects incomplete requests', async () => {
    const app = new Elysia().use(createPublicAccountClaimRoutes({
      getConfig: async () => enabledClaimConfig(),
      claimAccount: async () => ({ status: 'unavailable' }),
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account-claims/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: '张三' }),
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('invalid_request');
  });

  test('reuses an unclaimed encrypted initial password for import updates', () => {
    const previousSecret = process.env.ACCOUNT_CLAIM_SECRET;
    process.env.ACCOUNT_CLAIM_SECRET = 'account-claim-secret-for-test';
    try {
      const encrypted = encryptInitialPassword('Reset123!');
      const password = resolveProvisioningInitialPassword({
        external_id: '10086',
        external_type: 'employee',
        display_name: '张三',
        email: 'zhangsan@example.com',
      }, {
        initialPasswordEncrypted: encrypted,
        initialPasswordClaimed: false,
      });

      expect(password).toBe('Reset123!');
    } finally {
      if (previousSecret === undefined) delete process.env.ACCOUNT_CLAIM_SECRET;
      else process.env.ACCOUNT_CLAIM_SECRET = previousSecret;
    }
  });

  test('does not issue a new initial password after the account was claimed', () => {
    const password = resolveProvisioningInitialPassword({
      external_id: '10086',
      external_type: 'employee',
      display_name: '张三',
      email: 'zhangsan@example.com',
    }, {
      initialPasswordEncrypted: null,
      initialPasswordClaimed: true,
    });

    expect(password).toBeUndefined();
  });

  test('existing user updates preserve profile metadata without rewriting authorization metadata', () => {
    const payload = mergeUserPayload({
      email: 'old@example.com',
      user_metadata: { locale: 'zh-CN' },
      app_metadata: {
        role: 'authenticated',
        supaoauth: { existing: true },
      },
    }, {
      external_id: '10086',
      external_type: 'employee',
      display_name: '张三',
      email: 'zhangsan@example.com',
      profile: { department: 'Engineering' },
    }, 'Reset123!');

    expect(payload.password).toBe('Reset123!');
    expect(payload.email).toBe('zhangsan@example.com');
    expect(payload.user_metadata).toMatchObject({
      locale: 'zh-CN',
      name: '张三',
      full_name: '张三',
      department: 'Engineering',
    });
    expect(payload).not.toHaveProperty('app_metadata');
  });
});
