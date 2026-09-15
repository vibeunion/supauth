// Admin tool routes — RLS migration assistant and SDK coverage verification

import { Elysia } from 'elysia';
import { generateWrapperPolicies, type ExistingPolicy } from '../compatibility/rls-migration.js';
import { compileAuthorizationPlan } from '../compatibility/authorization-compiler.js';
import { operationContract, operationInput, operationOutput } from '../utils/operation-contract.js';

export const adminToolRoutes = new Elysia({ prefix: '/v1/admin-tools' })
  // ─── Supabase-native authorization compiler ───
  .post('/authorization-compiler', async ({ body }) => {
    const input = operationInput('compileAuthorizationPlan', body === undefined ? {} : { body });
    const { tables, storage_buckets, realtime_channels, edge_functions, ...options } = input.body ?? {};
    return operationOutput('compileAuthorizationPlan', compileAuthorizationPlan({
      ...options,
      tables: tables ?? [],
      storage_buckets: storage_buckets ?? [],
      realtime_channels: realtime_channels ?? [],
      edge_functions: edge_functions ?? [],
    }));
  }, operationContract('compileAuthorizationPlan', {
    detail: {
      summary: 'Compile Supabase-native authorization artifacts',
      description: 'Generates reviewable RLS, Storage, Realtime, Edge Function, rollback, and negative-test artifacts from SupaOAuth resources. Does NOT apply changes.',
      tags: ['Admin Tools'],
    },
  }))

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
  }, operationContract('getAuthorizationCompilerDemo', {
    detail: {
      summary: 'Authorization compiler demo',
      description: 'Shows generated Supabase-native authorization artifacts for tables, Storage, Realtime, and Edge Functions.',
      tags: ['Admin Tools'],
    },
  }))

  // ─── RLS Migration Assistant ───
  .post('/rls-migration', async ({ body }) => {
    // Accept an array of existing policies and generate wrapper policies
    const policies = operationInput('generateRLSMigration', { body }).body.policies || [];
    const result = generateWrapperPolicies(policies);
    return operationOutput('generateRLSMigration', result);
  }, operationContract('generateRLSMigration', {
    detail: {
      summary: 'Generate RLS wrapper policies',
      description: 'Analyzes existing RLS policies and generates wrapper policies that add supaoauth.authorize() alongside existing owner/team conditions. Does NOT modify the database — returns SQL for review.',
      tags: ['Admin Tools'],
    },
  }))

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
  }, operationContract('getRLSMigrationDemo', {
    detail: {
      summary: 'RLS migration demo with sample policies',
      description: 'Shows what the migration assistant produces for typical owner/team/admin policies',
      tags: ['Admin Tools'],
    },
  }));
