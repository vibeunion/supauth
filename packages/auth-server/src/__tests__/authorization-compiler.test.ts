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
    expect(result.sql.rollback).toContain('DROP POLICY IF EXISTS "supaoauth_projects_read"');
    expect(result.negative_tests).toContain('User without project.read is denied');
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
    expect(result.sql.realtime).toContain('project-updates');
    expect(result.edge_functions[0].middleware).toContain('Missing organization context');
    expect(result.permissions).toContain('billing.manage');
  });
});
