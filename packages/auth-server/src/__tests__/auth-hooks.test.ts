import { describe, expect, it } from 'bun:test';
import {
  AUTH_HOOK_TOP_LEVEL_SUPAOAUTH_CLAIM_KEYS,
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

  it('preserves Supabase required access token claims', () => {
    const requiredClaims = {
      iss: 'https://auth.example.test/auth/v1',
      aud: 'authenticated',
      exp: 1715690221,
      iat: 1715686621,
      sub: '8ccaa7af-909f-44e7-84cb-67cdccb56be6',
      role: 'authenticated',
      aal: 'aal2',
      session_id: '4b938a09-5372-4177-a314-cfa292099ea2',
      email: 'user@example.test',
      phone: '',
      is_anonymous: false,
    };

    const result = handleCustomAccessToken({
      authentication_method: 'oauth_provider/authorization_code',
      claims: {
        ...requiredClaims,
        app_metadata: { provider: 'email' },
        user_metadata: { name: 'Example User' },
      },
    });

    for (const [claim, value] of Object.entries(requiredClaims)) {
      expect(result.claims[claim]).toEqual(value);
    }
    expect((result.claims.app_metadata as any).supaoauth.hook.authentication_method).toBe('oauth_provider/authorization_code');
    expect((result.claims.user_metadata as any).name).toBe('Example User');
  });

  it('keeps enterprise RBAC metadata under app_metadata.supaoauth', () => {
    const result = handleCustomAccessToken({
      authentication_method: 'token_refresh',
      claims: {
        sub: 'user-1',
        role: 'authenticated',
        app_metadata: {
          supaoauth: {
            roles: ['xgic_admin'],
            rbac_version: 2,
            permissions_version: 3,
          },
        },
      },
    });

    expect(result.claims.role).toBe('authenticated');
    expect(result.claims.supaoauth).toBeUndefined();
    expect((result.claims.app_metadata as any).supaoauth.roles).toEqual(['xgic_admin']);
    expect((result.claims.app_metadata as any).supaoauth.permissions_version).toBe(3);
  });

  it('projects only the current application RBAC namespace into the access token', () => {
    const result = handleCustomAccessToken({
      authentication_method: 'oauth_provider/authorization_code',
      claims: {
        client_id: 'fa-app',
        app_metadata: {
          supaoauth: {
            roles: ['project_viewer'],
            permissions: ['project.read'],
            applications: {
              'fa-app': { roles: ['fa_engineer'], permissions: ['fa.rework.approve'] },
              'other-app': { roles: ['other_admin'], permissions: ['other.manage'] },
            },
          },
        },
      },
    });

    const supaoauth = (result.claims.app_metadata as any).supaoauth;
    expect(supaoauth.application_id).toBe('fa-app');
    expect(supaoauth.roles).toEqual(['fa_engineer']);
    expect(supaoauth.permissions).toEqual(['fa.rework.approve']);
    expect(supaoauth.applications).toBeUndefined();
  });

  it('removes legacy top-level SupaOAuth claims from custom access token output', () => {
    const result = handleCustomAccessToken({
      authentication_method: 'token_refresh',
      claims: {
        iss: 'https://auth.example.test/auth/v1',
        aud: 'authenticated',
        exp: 1715690221,
        iat: 1715686621,
        sub: 'user-1',
        role: 'authenticated',
        aal: 'aal1',
        session_id: 'session-1',
        email: 'user@example.test',
        phone: '',
        is_anonymous: false,
        supaoauth: { roles: ['injected'] },
        'supaoauth:roles': ['injected'],
        'supaoauth:org_id': 'org-injected',
        'supaoauth:org_role': 'owner',
        'supaoauth:scopes': ['admin'],
        'supaoauth:permissions': ['*'],
        app_metadata: {
          provider: 'email',
          supaoauth: {
            roles: ['xgic_admin'],
            permissions: ['xgic.read'],
          },
        },
        user_metadata: { name: 'Example User' },
      },
    });

    for (const claim of AUTH_HOOK_TOP_LEVEL_SUPAOAUTH_CLAIM_KEYS) {
      expect(result.claims[claim]).toBeUndefined();
    }

    const appMetadata = result.claims.app_metadata as Record<string, unknown>;
    const supaoauth = appMetadata.supaoauth as Record<string, unknown>;
    expect(result.claims.role).toBe('authenticated');
    expect(result.claims.session_id).toBe('session-1');
    expect(supaoauth.roles).toEqual(['xgic_admin']);
    expect(supaoauth.permissions).toEqual(['xgic.read']);
    expect((result.claims.user_metadata as Record<string, unknown>).name).toBe('Example User');
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
