import { describe, expect, it } from 'bun:test';
import {
  buildHookRegistrationGuide,
  handleBeforeUserCreated,
  handleCustomAccessToken,
  handleMfaVerificationAttempt,
} from '../auth/hooks-bridge.js';

describe('Auth Hooks bridge', () => {
  it('blocks signups from blocked domains', () => {
    const result = handleBeforeUserCreated(
      { user: { email: 'user@blocked.example' } },
      { blocked_email_domains: ['blocked.example'] },
    );

    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error.code).toBe('email_domain_blocked');
  });

  it('allows approved email domains and preserves empty success response', () => {
    const result = handleBeforeUserCreated(
      { user: { email: 'user@example.com' } },
      { allowed_email_domains: ['example.com'] },
    );

    expect(result).toEqual({});
  });

  it('enforces invite-only signup policy', () => {
    const result = handleBeforeUserCreated(
      { user: { email: 'user@example.com', user_metadata: {} } },
      { invite_only: true },
    );

    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error.code).toBe('invitation_required');
  });

  it('adds hook marker without removing existing app metadata', () => {
    const result = handleCustomAccessToken({
      authentication_method: 'password',
      claims: {
        sub: 'user-1',
        role: 'authenticated',
        app_metadata: {
          provider: 'email',
          supaoauth: { roles: ['admin'] },
        },
      },
    });

    expect(result.claims.role).toBe('authenticated');
    expect((result.claims.app_metadata as any).provider).toBe('email');
    expect((result.claims.app_metadata as any).supaoauth.roles).toEqual(['admin']);
    expect((result.claims.app_metadata as any).supaoauth.hook.version).toBe(1);
  });

  it('can deny high-risk MFA attempts', () => {
    const result = handleMfaVerificationAttempt({ metadata: { risk: 'high' } });

    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error.code).toBe('mfa_risk_denied');
  });

  it('builds hook registration URLs', () => {
    const guide = buildHookRegistrationGuide('https://auth.example.com/');

    expect(guide.before_user_created).toBe('https://auth.example.com/v1/auth-hooks/before-user-created');
    expect(guide.secret_header).toBe('x-supaoauth-hook-secret');
  });
});
