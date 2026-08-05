import { describe, expect, it } from 'bun:test';
import {
  type SecurityConfigValidationContext,
  validatedSecurityConfigUpdate,
} from '../routes/security-config-input.js';
import { ApiContractError } from '../utils/api-contract.js';

const productionSsoContext: SecurityConfigValidationContext = {
  currentAdminEmail: 'admin@example.com',
  authorizationSource: 'admin_allowlist',
  runtimeEnvironment: 'production',
};

const developmentTokenContext: SecurityConfigValidationContext = {
  currentAdminEmail: 'admin@example.com',
  authorizationSource: 'development_token',
  runtimeEnvironment: 'development',
};

describe('security configuration request boundary', () => {
  it('accepts a complete SSO update with exact emails and cleared legacy domains', () => {
    const update = {
      adminAuthMode: 'sso',
      adminAllowedEmails: ['admin@example.com'],
      adminAllowedDomains: [],
      rateLimitRpm: 300,
      rateLimitBurst: 50,
      bruteForceProtection: true,
      maxLoginAttempts: 10,
      lockoutDurationSec: 900,
      secretRotationReminderDays: 90,
      enforceHttps: true,
    };

    expect(validatedSecurityConfigUpdate(update, {
      ...productionSsoContext,
      currentAdminEmail: 'ADMIN@example.com',
    })).toEqual(update);
  });

  it.each([
    [{ adminAllowedDomains: [] }],
    [{ maxLoginAttempts: 20 }],
  ])('accepts safe partial updates without inferring missing authority', (update) => {
    expect(validatedSecurityConfigUpdate(update)).toEqual(update);
  });

  it.each([
    { adminAuthMode: 'token' },
    { adminAuthMode: 'token', adminAllowedEmails: ['ADMIN@example.com'] },
  ])('lets a non-production development-token administrator retain token mode', (update) => {
    const validated = validatedSecurityConfigUpdate(update, developmentTokenContext);
    expect(validated.adminAuthMode).toBe('token');
    expect(validated.adminAllowedEmails).toEqual(
      update.adminAllowedEmails ? [...update.adminAllowedEmails] : undefined,
    );
  });

  it.each([
    [{ adminAllowedEmails: ['admin@example.com'] }],
    [{ adminAuthMode: 'auto', adminAllowedEmails: ['ADMIN@example.com'] }],
    [{ adminAuthMode: 'sso', adminAllowedEmails: ['other@example.com', 'Admin@Example.com'] }],
  ])('retains the current administrator in email replacements', (update) => {
    expect(validatedSecurityConfigUpdate(update, productionSsoContext)).toEqual(update);
  });

  it.each([
    null,
    [],
    {},
    { unknown: true },
    { adminAuthMode: 'password' },
    { adminAuthMode: 'auto' },
    { adminAuthMode: 'sso' },
    { adminAuthMode: 'sso', adminAllowedEmails: [] },
    { adminAllowedEmails: [' admin@example.com'] },
    { adminAllowedEmails: [] },
    { adminAllowedEmails: Array(1) },
    { adminAllowedDomains: ['example.com'] },
    { bruteForceProtection: 'true' },
    { maxLoginAttempts: 0 },
    { maxLoginAttempts: 1.5 },
    { maxLoginAttempts: 10_001 },
    { lockoutDurationSec: -1 },
    { lockoutDurationSec: 2_592_001 },
  ].map(body => [body]))('rejects invalid or unsafe updates', (body) => {
    expect(() => validatedSecurityConfigUpdate(body, productionSsoContext)).toThrow(ApiContractError);
  });

  it.each([
    [{ adminAllowedEmails: ['other@example.com'] }, {}],
    [{ adminAllowedEmails: ['other@example.com'] }, productionSsoContext],
    [{ adminAuthMode: 'auto', adminAllowedEmails: ['other@example.com'] }, productionSsoContext],
    [{ adminAuthMode: 'sso', adminAllowedEmails: ['other@example.com'] }, productionSsoContext],
    [{ adminAuthMode: 'token', adminAllowedEmails: ['other@example.com'] }, productionSsoContext],
    [{ adminAuthMode: 'token', adminAllowedEmails: ['other@example.com'] }, developmentTokenContext],
    [{ adminAuthMode: 'token', adminAllowedEmails: [] }, developmentTokenContext],
  ])('rejects an email replacement that cannot preserve the current administrator', (update, context) => {
    expect(() => validatedSecurityConfigUpdate(update, context)).toThrow(ApiContractError);
  });

  it.each([
    [{ ...developmentTokenContext, runtimeEnvironment: 'production' }],
    [{ ...productionSsoContext, runtimeEnvironment: 'development' }],
    [{
      ...productionSsoContext,
      authorizationSource: 'rbac_projection' as const,
      runtimeEnvironment: 'development',
    }],
    [{}],
  ])('rejects token mode outside a non-production development-token session', (context) => {
    expect(() => validatedSecurityConfigUpdate({ adminAuthMode: 'token' }, context))
      .toThrow(ApiContractError);
  });
});
