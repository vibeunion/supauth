import { describe, it, expect } from 'bun:test';

describe('Security config repository — module structure', () => {
  it('exports all expected functions', async () => {
    const sec = await import('../repositories/security-config.js');
    const expectedFns = [
      'getSecurityConfig',
      'createSecurityConfig',
      'updateSecurityConfig',
      'isTokenAuthAllowed',
    ];
    for (const fn of expectedFns) {
      expect(typeof (sec as any)[fn]).toBe('function');
    }
  });
});

describe('Security config — isTokenAuthAllowed logic', () => {
  it('returns true when config is null (dev mode)', async () => {
    const { isTokenAuthAllowed } = await import('../repositories/security-config.js');
    expect(isTokenAuthAllowed(null)).toBe(true);
  });

  it('returns false when adminAuthMode is sso', async () => {
    const { isTokenAuthAllowed } = await import('../repositories/security-config.js');
    expect(isTokenAuthAllowed({
      id: 'test', adminAuthMode: 'sso',
      adminAllowedEmails: [], adminAllowedDomains: [],
      rateLimitRpm: 300, rateLimitBurst: 50,
      bruteForceProtection: true, maxLoginAttempts: 10,
      lockoutDurationSec: 900, secretRotationReminderDays: 90,
      enforceHttps: true,
    } as any)).toBe(false);
  });

  it('returns true when adminAuthMode is auto', async () => {
    const { isTokenAuthAllowed } = await import('../repositories/security-config.js');
    expect(isTokenAuthAllowed({
      id: 'test', adminAuthMode: 'auto',
      adminAllowedEmails: [], adminAllowedDomains: [],
      rateLimitRpm: 300, rateLimitBurst: 50,
      bruteForceProtection: true, maxLoginAttempts: 10,
      lockoutDurationSec: 900, secretRotationReminderDays: 90,
      enforceHttps: true,
    } as any)).toBe(true);
  });

  it('returns true when adminAuthMode is token', async () => {
    const { isTokenAuthAllowed } = await import('../repositories/security-config.js');
    expect(isTokenAuthAllowed({
      id: 'test', adminAuthMode: 'token',
      adminAllowedEmails: [], adminAllowedDomains: [],
      rateLimitRpm: 300, rateLimitBurst: 50,
      bruteForceProtection: true, maxLoginAttempts: 10,
      lockoutDurationSec: 900, secretRotationReminderDays: 90,
      enforceHttps: true,
    } as any)).toBe(true);
  });
});
