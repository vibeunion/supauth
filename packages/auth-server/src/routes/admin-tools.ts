// Admin tool routes — RLS migration assistant and SDK coverage verification

import { Elysia, t } from 'elysia';
import { generateWrapperPolicies, type ExistingPolicy } from '../compatibility/rls-migration.js';
import { compileAuthorizationPlan, type AuthorizationCompileRequest } from '../compatibility/authorization-compiler.js';

export const adminToolRoutes = new Elysia({ prefix: '/v1/admin-tools' })
  // ─── Supabase-native authorization compiler ───
  .post('/authorization-compiler', async ({ body }) => {
    return compileAuthorizationPlan(body as AuthorizationCompileRequest);
  }, {
    detail: {
      summary: 'Compile Supabase-native authorization artifacts',
      description: 'Generates reviewable RLS, Storage, Realtime, Edge Function, rollback, and negative-test artifacts from SupaOAuth resources. Does NOT apply changes.',
      tags: ['Admin Tools'],
    },
  })

  .get('/authorization-compiler/demo', async () => {
    return compileAuthorizationPlan({
      tables: [
        {
          schema: 'public',
          table: 'projects',
          permission_prefix: 'project',
          owner_column: 'owner_id',
          organization_column: 'org_id',
          operations: ['read', 'update', 'delete'],
        },
        {
          schema: 'public',
          table: 'documents',
          permission_prefix: 'document',
          organization_column: 'organization_id',
          operations: ['read', 'create', 'update'],
        },
      ],
      storage_buckets: [
        { bucket_id: 'project-assets', permission_prefix: 'project.asset', organization_path_prefix: 'org', operations: ['read', 'create', 'delete'] },
      ],
      realtime_channels: [
        { topic: 'project-updates', permission: 'project.read', organization_claim: 'current_org_id' },
      ],
      edge_functions: [
        { name: 'billing-portal', permission: 'billing.manage', require_organization: true },
      ],
    });
  }, {
    detail: {
      summary: 'Authorization compiler demo',
      description: 'Shows generated Supabase-native authorization artifacts for tables, Storage, Realtime, and Edge Functions.',
      tags: ['Admin Tools'],
    },
  })

  // ─── RLS Migration Assistant ───
  .post('/rls-migration', async ({ body }) => {
    // Accept an array of existing policies and generate wrapper policies
    const policies = (body as { policies: ExistingPolicy[] }).policies || [];
    const result = generateWrapperPolicies(policies);
    return result;
  }, {
    detail: {
      summary: 'Generate RLS wrapper policies',
      description: 'Analyzes existing RLS policies and generates wrapper policies that add supaoauth.authorize() alongside existing owner/team conditions. Does NOT modify the database — returns SQL for review.',
      tags: ['Admin Tools'],
    },
  })

  // ─── Demo mode ───
  .get('/rls-migration/demo', async () => {
    const samplePolicies: ExistingPolicy[] = [
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
      {
        schemaname: 'public',
        tablename: 'admin_only',
        policyname: 'admin access',
        policytype: 'permissive',
        cmd: 'ALL',
        qual: "auth.jwt() ->> 'role' = 'admin'",
        with_check: "auth.jwt() ->> 'role' = 'admin'",
        roles: ['authenticated'],
      },
    ];
    return generateWrapperPolicies(samplePolicies);
  }, {
    detail: {
      summary: 'RLS migration demo with sample policies',
      description: 'Shows what the migration assistant produces for typical owner/team/admin policies',
      tags: ['Admin Tools'],
    },
  });
