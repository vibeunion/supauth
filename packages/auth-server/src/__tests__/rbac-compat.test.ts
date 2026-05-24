import { describe, it, expect } from 'bun:test';
import { runRBACCompatibilityChecks } from '../compatibility/rbac.js';

describe('RBAC Compatibility Inspector', () => {
  it('returns all expected RBAC check IDs', async () => {
    process.env.RUNTIME_MODE = 'gotrue';
    process.env.SUPACLOUD_API_URL = 'http://localhost:9090';
    process.env.SUPACLOUD_MASTER_TOKEN = 'test';
    process.env.PROJECT_REF = 'test';
    process.env.DATABASE_URL = 'postgres://test';

    const results = await runRBACCompatibilityChecks();
    const checkIds = results.map(r => r.check_id);

    expect(checkIds).toContain('rb-1-authorize-function');
    expect(checkIds).toContain('rb-2-has-org-permission-function');
    expect(checkIds).toContain('rb-3-helper-grants');
    // RB-4 check_id varies by mode and runtime reachability:
    // gotrue + discovery reachable = rb-4-gotrue-jwt-role-safe
    // discovery unreachable = rb-4-jwt-role-check
    expect(checkIds.some(id => id.startsWith('rb-4-'))).toBe(true);
    expect(checkIds).toContain('rb-5-app-metadata-namespace');
    expect(checkIds).toContain('rb-6-schema-isolation');
    expect(checkIds).toContain('rb-7-unsafe-rls-patterns');
  });

  it('marks schema isolation as pass', async () => {
    process.env.RUNTIME_MODE = 'gotrue';
    process.env.SUPACLOUD_API_URL = 'http://localhost:9090';
    process.env.SUPACLOUD_MASTER_TOKEN = 'test';
    process.env.PROJECT_REF = 'test';
    process.env.DATABASE_URL = 'postgres://test';

    const results = await runRBACCompatibilityChecks();
    const schemaCheck = results.find(r => r.check_id === 'rb-6-schema-isolation');
    expect(schemaCheck?.status).toBe('pass');
  });

  it('marks app metadata namespace as pass', async () => {
    process.env.RUNTIME_MODE = 'gotrue';
    process.env.SUPACLOUD_API_URL = 'http://localhost:9090';
    process.env.SUPACLOUD_MASTER_TOKEN = 'test';
    process.env.PROJECT_REF = 'test';
    process.env.DATABASE_URL = 'postgres://test';

    const results = await runRBACCompatibilityChecks();
    const nsCheck = results.find(r => r.check_id === 'rb-5-app-metadata-namespace');
    expect(nsCheck?.status).toBe('pass');
  });

  it('includes details about required actions for offline checks', async () => {
    process.env.RUNTIME_MODE = 'gotrue';
    process.env.SUPACLOUD_API_URL = 'http://localhost:9090';
    process.env.SUPACLOUD_MASTER_TOKEN = 'test';
    process.env.PROJECT_REF = 'test';
    process.env.DATABASE_URL = 'postgres://test';

    const results = await runRBACCompatibilityChecks();
    const authorizeCheck = results.find(r => r.check_id === 'rb-1-authorize-function');
    expect(authorizeCheck?.details).toBeDefined();
    expect(authorizeCheck?.details?.required_action).toContain('migrate');
  });

  it('warns about unsafe RLS patterns', async () => {
    process.env.RUNTIME_MODE = 'gotrue';
    process.env.SUPACLOUD_API_URL = 'http://localhost:9090';
    process.env.SUPACLOUD_MASTER_TOKEN = 'test';
    process.env.PROJECT_REF = 'test';
    process.env.DATABASE_URL = 'postgres://test';

    const results = await runRBACCompatibilityChecks();
    const unsafeCheck = results.find(r => r.check_id === 'rb-7-unsafe-rls-patterns');
    expect(unsafeCheck?.status).toBe('warn');
    expect(unsafeCheck?.details?.unsafe_patterns).toBeDefined();
  });
});
