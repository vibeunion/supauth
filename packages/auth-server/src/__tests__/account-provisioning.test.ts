import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  createPublicAccountClaimRoutes,
  mergeUserPayload,
  resolveProvisioningInitialPassword,
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
      claimAccount: async () => ({
        status: 'claimed',
        email: 'zhangsan@example.team',
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
      email: 'zhangsan@example.team',
      initial_password: 'Init123!',
    });
  });

  test('public claim route does not return password after it was claimed', async () => {
    const app = new Elysia().use(createPublicAccountClaimRoutes({
      claimAccount: async () => ({
        status: 'already_claimed',
        email: 'zhangsan@example.team',
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
    expect(body.email).toBe('zhangsan@example.team');
    expect(body.initial_password).toBeUndefined();
  });

  test('public claim route rejects incomplete requests', async () => {
    const app = new Elysia().use(createPublicAccountClaimRoutes({
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
        email: 'zhangsan@example.team',
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
      email: 'zhangsan@example.team',
    }, {
      initialPasswordEncrypted: null,
      initialPasswordClaimed: true,
    });

    expect(password).toBeUndefined();
  });

  test('existing user updates can reset the password while preserving metadata', () => {
    const payload = mergeUserPayload({
      email: 'old@example.team',
      user_metadata: { locale: 'zh-CN' },
      app_metadata: {
        role: 'authenticated',
        supaoauth: { existing: true },
      },
    }, {
      external_id: '10086',
      external_type: 'employee',
      display_name: '张三',
      email: 'zhangsan@example.team',
      profile: { department: 'Engineering' },
    }, 'Reset123!');

    expect(payload.password).toBe('Reset123!');
    expect(payload.email).toBe('zhangsan@example.team');
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
