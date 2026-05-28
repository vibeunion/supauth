// P0-28: RBAC compatibility bridge routes
// Provides endpoints for importing legacy app_metadata.role values
// into SupaOAuth roles/permissions, with dry-run support.

import { Elysia } from 'elysia';
import {
  buildDefaultPolicy,
  ensureRolesExist,
  importLegacyRoles,
  generateCompatibilityHelper,
} from '../repositories/rbac-bridge.js';
import type { MigrationPolicy } from '../repositories/rbac-bridge.js';

export const rbacBridgeRoutes = new Elysia({ prefix: '/v1/rbac-bridge' })
  .get('/default-policy', () => {
    return buildDefaultPolicy();
  }, {
    detail: {
      summary: 'Get the default RBAC migration policy',
      description: 'Returns the default mapping from legacy app_metadata.role values to SupaOAuth roles.',
      tags: ['RBAC Bridge'],
    },
  })

  .post('/dry-run', async ({ body }) => {
    const policy = (body as Partial<MigrationPolicy>) || {};
    const fullPolicy: MigrationPolicy = {
      ...buildDefaultPolicy(),
      ...policy,
      dryRun: true,
    };
    const result = await importLegacyRoles(fullPolicy);
    return result;
  }, {
    detail: {
      summary: 'Dry-run legacy role import',
      description: 'Reports what would be migrated without making any changes.',
      tags: ['RBAC Bridge'],
    },
  })

  .post('/import', async ({ body }) => {
    const policy = (body as Partial<MigrationPolicy>) || {};
    const fullPolicy: MigrationPolicy = {
      ...buildDefaultPolicy(),
      ...policy,
      dryRun: false,
    };

    // Ensure target roles exist before import
    if (fullPolicy.autoCreateRoles) {
      const created = await ensureRolesExist(fullPolicy);
      if (created.length > 0) {
        console.log(`RBAC bridge: auto-created roles: ${created.join(', ')}`);
      }
    }

    const result = await importLegacyRoles(fullPolicy);
    return result;
  }, {
    detail: {
      summary: 'Execute legacy role import',
      description: 'Imports legacy app_metadata.role values into SupaOAuth role assignments. Use dry-run first to preview.',
      tags: ['RBAC Bridge'],
    },
  })

  .get('/compatibility-helper', ({ query }) => {
    const projectRef = (query.project_ref as string) || 'YOUR_PROJECT_REF';
    return { sql: generateCompatibilityHelper(projectRef) };
  }, {
    detail: {
      summary: 'Generate SQL compatibility helper',
      description: 'Returns a SQL function that bridges SupaOAuth roles to legacy app_metadata.role for backward compatibility.',
      tags: ['RBAC Bridge'],
    },
  });
