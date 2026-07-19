import { describe, expect, it } from 'bun:test';
import { compileAuthorizationPlan } from '../compatibility/authorization-compiler.js';

describe('Authorization compiler', () => {
  it('generates org-scoped table RLS with rollback and negative tests', () => {
    const result = compileAuthorizationPlan({
      tables: [
        {
          schema: 'public',
          table: 'projects',
          permission_prefix: 'project',
          organization_column: 'org_id',
          operations: ['read', 'update'],
        },
      ],
    });

    expect(result.permissions).toEqual(['project.read', 'project.update']);
    expect(result.sql.tables).toContain('supaoauth.has_org_permission("org_id", \'project.read\')');
    expect(result.sql.tables).toContain('FOR SELECT');
    expect(result.sql.tables).toContain('FOR UPDATE');
    expect(result.sql.helpers).toContain('supaoauth.has_permission(permission_name text, target_organization_id uuid default null)');
    expect(result.sql.rollback).toContain('DROP POLICY IF EXISTS "supaoauth_projects_read"');
    expect(result.negative_tests).toContain('User without project.read is denied');
    expect(result.negative_tests).toContain('JWT role remains a Supabase runtime role (anon/authenticated/service_role) and business roles are not written to the top-level role claim');
  });

  it('preserves owner fallback when owner_column is provided', () => {
    const result = compileAuthorizationPlan({
      tables: [
        {
          table: 'documents',
          owner_column: 'owner_id',
          permission_prefix: 'document',
          operations: ['read'],
        },
      ],
    });

    expect(result.sql.tables).toContain('"owner_id" = auth.uid() OR supaoauth.authorize(\'document.read\')');
  });

  it('generates Storage, Realtime, and Edge Function artifacts', () => {
    const result = compileAuthorizationPlan({
      project_ref: 'project-a',
      storage_buckets: [
        { bucket_id: 'project-assets', permission_prefix: 'project.asset', operations: ['read', 'create'] },
      ],
      realtime_channels: [
        { topic: 'project-updates', permission: 'project.read', organization_claim: 'current_org_id' },
      ],
      edge_functions: [
        { name: 'billing-portal', permission: 'billing.manage', require_organization: true },
      ],
    });

    expect(result.sql.storage).toContain('ON storage.objects');
    expect(result.sql.storage).toContain('bucket_id = \'project-assets\'');
    expect(result.sql.realtime).toContain('supaoauth.current_project_claims()');
    expect(result.sql.realtime).toContain('project-updates');
    expect(result.edge_functions[0].middleware).toContain('projects?.["project-a"]');
    expect(result.edge_functions[0].middleware).toContain('Missing organization context');
    expect(result.permissions).toContain('billing.manage');
  });

  it('fails closed when an Edge organization gate has no project ref', () => {
    const result = compileAuthorizationPlan({
      edge_functions: [
        { name: 'billing-portal', permission: 'billing.manage', require_organization: true },
      ],
    });

    expect(result.warnings).toContain(
      'project_ref is required for project-scoped Edge Function organization claims; generated middleware fails closed.',
    );
    expect(result.edge_functions[0].middleware).toContain('Missing project authorization context');
    expect(result.edge_functions[0].middleware).not.toContain('supaoauth?.current_org_id');
  });
});
