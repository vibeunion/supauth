import { describe, expect, test } from 'bun:test';
import { buildGoTrueLogoutUrl, resolveGoTrueLogoutUrl } from '../auth/gotrue-logout-url.js';

describe('GoTrue logout URL resolution', () => {
  test('adds the auth prefix exactly once', () => {
    expect(buildGoTrueLogoutUrl('https://auth.example.test')).toBe('https://auth.example.test/auth/v1/logout');
    expect(buildGoTrueLogoutUrl('https://auth.example.test/auth/v1')).toBe('https://auth.example.test/auth/v1/logout');
    expect(buildGoTrueLogoutUrl('https://auth.example.test/auth/v1/logout')).toBe('https://auth.example.test/auth/v1/logout');
  });

  test('uses the same environment precedence for health and auth routes', () => {
    expect(resolveGoTrueLogoutUrl({
      GOTRUE_LOGOUT_URL: '',
      OAUTH_RUNTIME_URL: 'https://internal-auth.example.test/auth/v1/',
      SUPACLOUD_RUNTIME_URL: 'https://public-auth.example.test',
    })).toBe('https://internal-auth.example.test/auth/v1/logout');
  });
});
