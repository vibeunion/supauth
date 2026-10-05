// P0-28: RBAC compatibility bridge routes
// Provides endpoints for importing legacy app_metadata.role values
// into SupaOAuth roles/permissions, with dry-run support.


import {
  buildDefaultPolicy,
  ensureRolesExist,
  importLegacyRoles,
  generateCompatibilityHelper,
} from '../repositories/rbac-bridge.js';
import type { MigrationPolicy } from '../repositories/rbac-bridge.js';
import { operationContract, operationInput, operationOutput } from '../utils/operation-contract.js';
import { defineHttpOperation, defineHttpOperations } from '../http/operation.js';

export const rbacBridgeRoutes = defineHttpOperations({ prefix: '/v1/rbac-bridge' }, {
  getDefaultPolicy: defineHttpOperation('GET', '/default-policy', () => {
    return buildDefaultPolicy();
  }, operationContract('getRbacMigrationPolicy', {
    detail: {
      summary: 'Get the default RBAC migration policy',
      description: 'Returns the default mapping from legacy app_metadata.role values to SupaOAuth roles.',
      tags: ['RBAC Bridge'],
    },
  })),

  postDryRun: defineHttpOperation('POST', '/dry-run', async ({ body }) => {
    const policy = operationInput('dryRunRbacMigration', body === undefined ? {} : { body }).body || {};
    const fullPolicy: MigrationPolicy = {
      ...buildDefaultPolicy(),
      ...policy,
      dryRun: true,
    };
    const result = await importLegacyRoles(fullPolicy);
    return operationOutput('dryRunRbacMigration', result);
  }, operationContract('dryRunRbacMigration', {
    detail: {
      summary: 'Dry-run legacy role import',
      description: 'Reports what would be migrated without making any changes.',
      tags: ['RBAC Bridge'],
    },
  })),

  postImport: defineHttpOperation('POST', '/import', async ({ body }) => {
    const policy = operationInput('importRbacMigration', body === undefined ? {} : { body }).body || {};
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
    return operationOutput('importRbacMigration', result);
  }, operationContract('importRbacMigration', {
    detail: {
      summary: 'Execute legacy role import',
      description: 'Imports legacy app_metadata.role values into SupaOAuth role assignments. Use dry-run first to preview.',
      tags: ['RBAC Bridge'],
    },
  })),

  getCompatibilityHelper: defineHttpOperation('GET', '/compatibility-helper', ({ query }) => {
    const projectRef = operationInput('getRbacCompatibilityHelper', { query }).query?.project_ref || 'YOUR_PROJECT_REF';
    return { sql: generateCompatibilityHelper(projectRef) };
  }, operationContract('getRbacCompatibilityHelper', {
    detail: {
      summary: 'Generate SQL compatibility helper',
      description: 'Returns a SQL function that bridges SupaOAuth roles to legacy app_metadata.role for backward compatibility.',
      tags: ['RBAC Bridge'],
    },
  })),
});
