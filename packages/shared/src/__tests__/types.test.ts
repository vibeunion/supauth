import { describe, it, expect } from 'bun:test';
import { SUPABASE_REQUIRED_CLAIMS, SUPAOAUTH_CLAIMS_NAMESPACE } from '../index.js';

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
});
