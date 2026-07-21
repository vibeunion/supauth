import { describe, expect, test } from 'bun:test';
import {
  adminSsoAllowlistCountsFromRow,
  verifyAdminSsoAllowlist,
} from '../compatibility/admin-sso-verify.js';

describe('Admin SSO allowlist verifier', () => {
  test('returns only normalized database counts', () => {
    expect(adminSsoAllowlistCountsFromRow({ email_count: '2', domain_count: 1 })).toEqual({
      emailCount: 2,
      domainCount: 1,
    });
    expect(adminSsoAllowlistCountsFromRow()).toEqual({ emailCount: 0, domainCount: 0 });
  });

  test('rejects invalid count rows', () => {
    expect(() => adminSsoAllowlistCountsFromRow({ email_count: -1, domain_count: 0 }))
      .toThrow('invalid email count');
    expect(() => adminSsoAllowlistCountsFromRow({ email_count: 0, domain_count: 'not-a-number' }))
      .toThrow('invalid domain count');
  });

  test('requires an explicit database URL', async () => {
    await expect(verifyAdminSsoAllowlist('')).rejects.toThrow('SUPACLOUD_DATABASE_URL');
  });
});
