import { describe, it, expect } from 'bun:test';
import {
  GOTRUE_CLAIMS_STRATEGY,
  SUPABASE_METADATA_CLAIMS,
  SUPABASE_OAUTH_ACCESS_TOKEN_CLAIMS,
  SUPABASE_OAUTH_STANDARD_SCOPES,
  SUPABASE_REQUIRED_CLAIMS,
  SUPABASE_RUNTIME_ROLES,
  SUPAOAUTH_APP_METADATA_KEY,
  SUPAOAUTH_APP_METADATA_SCHEMA_VERSION,
  SUPAOAUTH_CLAIM_KEYS,
  SUPAOAUTH_CLAIMS_NAMESPACE,
  SUPAOAUTH_PERMISSION_PROJECTION_LIMIT,
  SUPAOAUTH_ORGANIZATION_MEMBERSHIP_FIELD_LENGTH_LIMIT,
  SUPAOAUTH_ORGANIZATION_MEMBERSHIP_LIMIT,
  SUPAOAUTH_NAMESPACE_PROJECTION_BYTE_LIMIT,
  SUPAOAUTH_PROJECT_PROJECTION_BYTE_LIMIT,
  SUPAOAUTH_ROLE_PROJECTION_LIMIT,
} from '../index.js';
import type { CapabilitiesResponse, CapabilityStatus } from '../index.js';

describe('Shared types', () => {
  it('requires capability verification timestamps in the shared API contract', () => {
    const response: CapabilitiesResponse = {
      runtime_mode: 'gotrue',
      capabilities: {
        example: {
          available: false,
          source: 'gotrue',
          version: null,
          reason_code: 'not_advertised_by_upstream',
          last_verified_at: '2026-08-04T00:00:00.000Z',
        },
      },
    };

    expect(response.capabilities.example.last_verified_at)
      .toBe('2026-08-04T00:00:00.000Z');
  });

  it('models capability availability and reason as one discriminated contract', () => {
    const availableReason: Extract<CapabilityStatus, { available: true }>['reason_code'] = null;
    const unavailableReason: Extract<CapabilityStatus, { available: false }>['reason_code'] = 'not_supported';

    expect(availableReason).toBeNull();
    expect(unavailableReason).toBe('not_supported');
  });

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
    expect(SUPAOAUTH_APP_METADATA_SCHEMA_VERSION).toBe(2);
    expect(GOTRUE_CLAIMS_STRATEGY.roles.key)
      .toBe('app_metadata.supaoauth.projects.{projectRef}.roles');
    expect(GOTRUE_CLAIMS_STRATEGY.organization.key)
      .toBe('app_metadata.supaoauth.projects.{projectRef}.current_org_id');
    expect(GOTRUE_CLAIMS_STRATEGY.scopes.key)
      .toBe('app_metadata.supaoauth.projects.{projectRef}.scopes');
    expect(GOTRUE_CLAIMS_STRATEGY.permissions.key)
      .toBe('app_metadata.supaoauth.projects.{projectRef}.permissions');
    expect(GOTRUE_CLAIMS_STRATEGY.applications.key)
      .toBe('app_metadata.supaoauth.projects.{projectRef}.applications');
  });

  it('keeps Supabase runtime roles intact', () => {
    expect(SUPABASE_RUNTIME_ROLES).toEqual(['anon', 'authenticated', 'service_role']);
  });

  it('exports bounded SupaOAuth metadata projection limits', () => {
    expect(SUPAOAUTH_ROLE_PROJECTION_LIMIT).toBe(64);
    expect(SUPAOAUTH_PERMISSION_PROJECTION_LIMIT).toBe(256);
    expect(SUPAOAUTH_PROJECT_PROJECTION_BYTE_LIMIT).toBe(16 * 1024);
    expect(SUPAOAUTH_NAMESPACE_PROJECTION_BYTE_LIMIT).toBe(64 * 1024);
    expect(SUPAOAUTH_ORGANIZATION_MEMBERSHIP_LIMIT).toBe(50);
    expect(SUPAOAUTH_ORGANIZATION_MEMBERSHIP_FIELD_LENGTH_LIMIT).toBe(128);
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
