import { describe, it, expect } from 'bun:test';
import {
  GOTRUE_CLAIMS_STRATEGY,
  SUPABASE_METADATA_CLAIMS,
  SUPABASE_OAUTH_ACCESS_TOKEN_CLAIMS,
  SUPABASE_OAUTH_STANDARD_SCOPES,
  SUPABASE_REQUIRED_CLAIMS,
  SUPABASE_RUNTIME_ROLES,
  SUPAOAUTH_APP_METADATA_KEY,
  SUPAOAUTH_CLAIM_KEYS,
  SUPAOAUTH_CLAIMS_NAMESPACE,
} from '../index.js';

describe('Shared types', () => {
  it('exports required Supabase claims', () => {
    expect(SUPABASE_REQUIRED_CLAIMS).toContain('sub');
    expect(SUPABASE_REQUIRED_CLAIMS).toContain('role');
    expect(SUPABASE_REQUIRED_CLAIMS).toContain('aud');
    expect(SUPABASE_REQUIRED_CLAIMS).toContain('iss');
    expect(SUPABASE_REQUIRED_CLAIMS).toContain('exp');
    expect(SUPABASE_REQUIRED_CLAIMS).toContain('iat');
    expect(SUPABASE_REQUIRED_CLAIMS).toContain('aal');
    expect(SUPABASE_REQUIRED_CLAIMS).toContain('session_id');
    expect(SUPABASE_REQUIRED_CLAIMS).toContain('email');
    expect(SUPABASE_REQUIRED_CLAIMS).toContain('phone');
    expect(SUPABASE_REQUIRED_CLAIMS).toContain('is_anonymous');
    expect(SUPABASE_REQUIRED_CLAIMS).not.toContain('app_metadata');
    expect(SUPABASE_REQUIRED_CLAIMS).not.toContain('user_metadata');
  });

  it('exports metadata claims separately from required hook claims', () => {
    expect(SUPABASE_METADATA_CLAIMS).toEqual(['app_metadata', 'user_metadata']);
    for (const claim of SUPABASE_METADATA_CLAIMS) {
      expect(SUPABASE_REQUIRED_CLAIMS).not.toContain(claim);
    }
  });

  it('exports claims namespace', () => {
    expect(SUPAOAUTH_CLAIMS_NAMESPACE).toBe('supaoauth');
    expect(SUPAOAUTH_CLAIM_KEYS).toEqual([
      'supaoauth:roles',
      'supaoauth:org_id',
      'supaoauth:org_role',
      'supaoauth:scopes',
      'supaoauth:permissions',
    ]);
  });

  it('uses app_metadata.supaoauth as gotrue-mode namespace', () => {
    expect(SUPAOAUTH_APP_METADATA_KEY).toBe('supaoauth');
    expect(GOTRUE_CLAIMS_STRATEGY.roles.key).toBe('app_metadata.supaoauth.roles');
    expect(GOTRUE_CLAIMS_STRATEGY.organization.key).toBe('app_metadata.supaoauth.current_org_id');
  });

  it('keeps Supabase runtime roles intact', () => {
    expect(SUPABASE_RUNTIME_ROLES).toEqual(['anon', 'authenticated', 'service_role']);
  });

  it('exports Supabase OAuth access-token claims separately from all JWT claims', () => {
    expect(SUPABASE_OAUTH_ACCESS_TOKEN_CLAIMS).toEqual(['client_id', 'scope']);
    expect(SUPABASE_REQUIRED_CLAIMS).not.toContain('user_id');
    expect(SUPABASE_REQUIRED_CLAIMS).not.toContain('client_id');
    expect(SUPABASE_REQUIRED_CLAIMS).not.toContain('scope');
  });

  it('exports Supabase OAuth standard scopes separately from JWT claims', () => {
    expect(SUPABASE_OAUTH_STANDARD_SCOPES).toEqual(['openid', 'email', 'profile', 'phone']);
    for (const scope of SUPABASE_OAUTH_STANDARD_SCOPES) {
      expect(SUPABASE_OAUTH_ACCESS_TOKEN_CLAIMS).not.toContain(scope);
    }
    expect(SUPABASE_REQUIRED_CLAIMS).not.toContain('openid');
    expect(SUPABASE_REQUIRED_CLAIMS).not.toContain('profile');
    expect(SUPABASE_REQUIRED_CLAIMS).toContain('email');
    expect(SUPABASE_REQUIRED_CLAIMS).toContain('phone');
  });
});
