import { describe, it, expect } from 'bun:test';
import { GOTRUE_CLAIMS_STRATEGY, SUPABASE_REQUIRED_CLAIMS, SUPAOAUTH_APP_METADATA_KEY, SUPAOAUTH_CLAIMS_NAMESPACE } from '../index.js';

describe('Shared types', () => {
  it('exports required Supabase claims', () => {
    expect(SUPABASE_REQUIRED_CLAIMS).toContain('sub');
    expect(SUPABASE_REQUIRED_CLAIMS).toContain('role');
    expect(SUPABASE_REQUIRED_CLAIMS).toContain('aud');
    expect(SUPABASE_REQUIRED_CLAIMS).toContain('iss');
    expect(SUPABASE_REQUIRED_CLAIMS).toContain('exp');
    expect(SUPABASE_REQUIRED_CLAIMS).toContain('app_metadata');
    expect(SUPABASE_REQUIRED_CLAIMS).toContain('user_metadata');
  });

  it('exports claims namespace', () => {
    expect(SUPAOAUTH_CLAIMS_NAMESPACE).toBe('supaoauth');
  });

  it('uses app_metadata.supaoauth as gotrue-mode namespace', () => {
    expect(SUPAOAUTH_APP_METADATA_KEY).toBe('supaoauth');
    expect(GOTRUE_CLAIMS_STRATEGY.roles.key).toBe('supaoauth.roles');
    expect(GOTRUE_CLAIMS_STRATEGY.organization.key).toBe('supaoauth.current_org_id');
  });
});
