import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  createPublicAccountClaimRoutes,
  mergeUserPayload,
  resolveProvisioningInitialPassword,
  sanitizeAccountClaimConfig,
} from '../routes/account-provisioning.js';
import {
  decryptInitialPassword,
  encryptInitialPassword,
  externalIdLookupCandidates,
  normalizeDisplayName,
  normalizeExternalId,
} from '../repositories/account-provisioning.js';

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

  test('public claim route returns email and initial password once', async () => {
    const app = new Elysia().use(createPublicAccountClaimRoutes({
      getConfig: async () => sanitizeAccountClaimConfig({}),
      claimAccount: async () => ({
        status: 'claimed',
        email: 'zhangsan@example.com',
        initialPassword: 'Init123!',
      }),
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account-claims/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: '张三', external_id: '10086', external_type: 'employee' }),
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
      password: { mode: 'set_on_claim', min_length: 10 },
      phrases: {
        'zh-CN': { submitSetPassword: '领取并设置密码' },
        en: { submitSetPassword: 'Claim and set password' },
      },
    });

    expect(sanitizeAccountClaimConfig({ value: { password: { mode: 'unknown', min_length: 2 } } })).toEqual({
      enabled: true,
      external_type: 'employee',
      password: { mode: 'show_initial_password', min_length: 6 },
      phrases: {},
    });
  });

  test('public claim config route exposes sanitized configuration', async () => {
    const app = new Elysia().use(createPublicAccountClaimRoutes({
      getConfig: async () => sanitizeAccountClaimConfig({
        value: {
          external_type: 'member',
          password: { mode: 'set_on_claim', min_length: 12 },
        },
      }),
      claimAccount: async () => ({ status: 'not_found' }),
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account-claims/config'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      config: {
        enabled: true,
        external_type: 'member',
        password: { mode: 'set_on_claim', min_length: 12 },
        phrases: {},
      },
    });
  });

  test('public claim route requires a new password when configured', async () => {
    const app = new Elysia().use(createPublicAccountClaimRoutes({
      getConfig: async () => sanitizeAccountClaimConfig({
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
      body: JSON.stringify({ display_name: '张三', external_id: '10086', external_type: 'employee' }),
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('password_too_short');
  });

  test('public claim route can claim by setting a new password instead of returning the initial password', async () => {
    let receivedInput: {
      passwordMode?: string;
      newPassword?: string;
      updatePassword?: unknown;
    } | undefined;
    const app = new Elysia().use(createPublicAccountClaimRoutes({
      getConfig: async () => sanitizeAccountClaimConfig({
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
      body: JSON.stringify({
        display_name: '张三',
        external_id: '10086',
        external_type: 'employee',
        new_password: 'NewPass123!',
      }),
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
      newPassword: 'NewPass123!',
    });
    expect(typeof receivedInput?.updatePassword).toBe('function');
  });

  test('public claim route does not return password after it was claimed', async () => {
    const app = new Elysia().use(createPublicAccountClaimRoutes({
      getConfig: async () => sanitizeAccountClaimConfig({}),
      claimAccount: async () => ({
        status: 'already_claimed',
        email: 'zhangsan@example.com',
        claimedAt: new Date('2026-06-09T00:00:00.000Z'),
      }),
    }));

    const response = await app.handle(new Request('http://localhost/v1/public/account-claims/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: '张三', external_id: '10086', external_type: 'employee' }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.status).toBe('already_claimed');
    expect(body.email).toBe('zhangsan@example.com');
    expect(body.initial_password).toBeUndefined();
  });

  test('public claim route rejects incomplete requests', async () => {
    const app = new Elysia().use(createPublicAccountClaimRoutes({
      getConfig: async () => sanitizeAccountClaimConfig({}),
      claimAccount: async () => ({ status: 'not_found' }),
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

  test('existing user updates can reset the password while preserving metadata', () => {
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
    expect(payload.app_metadata).toMatchObject({
      role: 'authenticated',
      supaoauth: {
        existing: true,
        employee_id: '10086',
        external_id: '10086',
        external_type: 'employee',
      },
    });
  });
});
