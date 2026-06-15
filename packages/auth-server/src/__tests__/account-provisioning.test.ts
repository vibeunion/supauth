import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  createPublicAccountClaimRoutes,
} from '../routes/account-provisioning.js';
import {
  decryptInitialPassword,
  encryptInitialPassword,
  normalizeDisplayName,
  normalizeExternalId,
} from '../repositories/account-provisioning.js';

describe('account provisioning and claiming', () => {
  test('normalizes account claim identity fields', () => {
    expect(normalizeDisplayName(' 张 三 ')).toBe('张三');
    expect(normalizeExternalId('  10086  ')).toBe('10086');
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
});
