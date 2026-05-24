// Admin tool routes — RLS migration assistant and SDK coverage verification

import { Elysia, t } from 'elysia';
import { generateWrapperPolicies, type ExistingPolicy } from '../compatibility/rls-migration.js';

export const adminToolRoutes = new Elysia({ prefix: '/v1/admin-tools' })
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
