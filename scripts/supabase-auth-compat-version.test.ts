import { describe, expect, it } from 'bun:test';
import {
  CURRENT_COMPAT_VERSION,
  SUPPORTED_COMPAT_VERSIONS,
  assertExpectedRuntimeVersion,
  compatibilityScopes,
  requiresOfflineAccess,
} from './supabase-auth-compat-version.js';

describe('GoTrue compatibility version policy', () => {
  it('retains floor and regression targets when advancing current', () => {
    expect(CURRENT_COMPAT_VERSION).toBe('v2.197.0');
    expect(SUPPORTED_COMPAT_VERSIONS).toEqual(['v2.192.0', 'v2.196.0', 'v2.197.0']);
  });

  for (const version of ['v2.192.0', 'v2.196.0', 'v2.197.0']) {
    it(`requires exact health readback for ${version}`, () => {
      expect(() => assertExpectedRuntimeVersion(version, version)).not.toThrow();
      for (const other of SUPPORTED_COMPAT_VERSIONS.filter(value => value !== version)) {
        expect(() => assertExpectedRuntimeVersion(other, version)).toThrow(
          `Expected GoTrue ${version} but runtime health reports ${other}`,
        );
      }
    });
  }

  it('keeps the floor scopes unchanged', () => {
    expect(requiresOfflineAccess('v2.192.0')).toBe(false);
    expect(compatibilityScopes('v2.192.0')).toEqual(['openid', 'email', 'profile']);
  });

  for (const version of ['v2.196.0', 'v2.197.0']) {
    it(`requires offline_access for ${version} independently of current`, () => {
      expect(requiresOfflineAccess(version)).toBe(true);
      expect(compatibilityScopes(version)).toEqual(['openid', 'email', 'profile', 'offline_access']);
    });
  }

  it('rejects unsupported versions instead of falling back to floor capabilities', () => {
    for (const version of ['v2.195.0', 'v2.198.0', '', '2.197.0', 'v2.197.0-rc.1']) {
      expect(() => assertExpectedRuntimeVersion(version, version)).toThrow('Unsupported GoTrue compatibility matrix version');
      expect(() => compatibilityScopes(version)).toThrow('Unsupported GoTrue compatibility matrix version');
    }
  });
});
