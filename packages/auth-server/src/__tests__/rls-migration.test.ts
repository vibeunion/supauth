import { describe, it, expect } from 'bun:test';
import { generateWrapperPolicies, type ExistingPolicy } from '../compatibility/rls-migration.js';

describe('RLS Migration Assistant', () => {
  it('generates wrapper policies for owner-based policies', () => {
    const policies: ExistingPolicy[] = [
      {
        schemaname: 'public',
        tablename: 'projects',
        policyname: 'owner can read',
        policytype: 'permissive',
        cmd: 'SELECT',
        qual: 'owner_id = auth.uid()',
        with_check: null,
        roles: ['authenticated'],
      },
    ];

    const result = generateWrapperPolicies(policies);

    expect(result.scanned_policies).toBe(1);
    expect(result.candidate_policies).toBe(1);
    expect(result.wrappers).toHaveLength(1);
    expect(result.wrappers[0].original_policy).toBe('owner can read');
    expect(result.wrappers[0].wrapper_policy_name).toBe('owner can read_with_rbac');
    expect(result.wrappers[0].permission_name).toBe('project.read');
    expect(result.wrappers[0].wrapper_using).toContain('supaoauth.authorize');
    expect(result.wrappers[0].wrapper_using).toContain('owner_id = auth.uid()');
    expect(result.migration_sql).toContain('supaoauth.authorize');
  });

  it('detects unsafe JWT role claim usage', () => {
    const policies: ExistingPolicy[] = [
      {
        schemaname: 'public',
        tablename: 'admin_only',
        policyname: 'admin access',
        policytype: 'permissive',
        cmd: 'ALL',
        qual: "auth.jwt() ->> 'role' = 'admin'",
        with_check: null,
        roles: ['authenticated'],
      },
    ];

    const result = generateWrapperPolicies(policies);

    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings[0]).toContain('UNSAFE');
    expect(result.warnings[0]).toContain('JWT role claim');
    // This policy doesn't have an owner pattern, so it shouldn't get a wrapper
    expect(result.candidate_policies).toBe(0);
  });

  it('skips restrictive policies', () => {
    const policies: ExistingPolicy[] = [
      {
        schemaname: 'public',
        tablename: 'projects',
        policyname: 'restrict access',
        policytype: 'restrictive',
        cmd: 'SELECT',
        qual: 'owner_id = auth.uid()',
        with_check: null,
        roles: ['authenticated'],
      },
    ];

    const result = generateWrapperPolicies(policies);
    expect(result.candidate_policies).toBe(0);
  });

  it('handles INSERT/UPDATE with WITH CHECK', () => {
    const policies: ExistingPolicy[] = [
      {
        schemaname: 'public',
        tablename: 'projects',
        policyname: 'owner can update',
        policytype: 'permissive',
        cmd: 'UPDATE',
        qual: 'owner_id = auth.uid()',
        with_check: 'owner_id = auth.uid()',
        roles: ['authenticated'],
      },
    ];

    const result = generateWrapperPolicies(policies);

    expect(result.wrappers).toHaveLength(1);
    expect(result.wrappers[0].wrapper_using).toContain('supaoauth.authorize');
    expect(result.wrappers[0].wrapper_with_check).toContain('supaoauth.authorize');
    expect(result.wrappers[0].permission_name).toBe('project.update');
  });

  it('generates correct ALL command wrapper', () => {
    const policies: ExistingPolicy[] = [
      {
        schemaname: 'public',
        tablename: 'documents',
        policyname: 'owner full access',
        policytype: 'permissive',
        cmd: 'ALL',
        qual: 'owner_id = auth.uid()',
        with_check: null,
        roles: ['authenticated'],
      },
    ];

    const result = generateWrapperPolicies(policies);

    expect(result.wrappers).toHaveLength(1);
    expect(result.wrappers[0].permission_name).toBe('document.manage');
    expect(result.migration_sql).toContain('FOR ALL');
  });

  it('handles reverse owner pattern (column = auth.uid())', () => {
    const policies: ExistingPolicy[] = [
      {
        schemaname: 'public',
        tablename: 'tasks',
        policyname: 'owner read',
        policytype: 'permissive',
        cmd: 'SELECT',
        qual: 'auth.uid() = tasks.owner_id',
        with_check: null,
        roles: ['authenticated'],
      },
    ];

    const result = generateWrapperPolicies(policies);
    expect(result.candidate_policies).toBe(1);
    expect(result.wrappers[0].wrapper_using).toContain('supaoauth.authorize');
  });

  it('returns empty wrappers when no owner patterns match', () => {
    const policies: ExistingPolicy[] = [
      {
        schemaname: 'public',
        tablename: 'public_data',
        policyname: 'anyone can read',
        policytype: 'permissive',
        cmd: 'SELECT',
        qual: 'true',
        with_check: null,
        roles: ['authenticated'],
      },
    ];

    const result = generateWrapperPolicies(policies);
    expect(result.candidate_policies).toBe(0);
    expect(result.wrappers).toHaveLength(0);
  });
});
