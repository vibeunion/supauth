// P0-28: RBAC compatibility bridge for existing SupaCloud business apps.
// Provides tools to map legacy app_metadata.role values to SupaOAuth
// roles/permissions, with dry-run and rollback support.

import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as roleRepo from './roles.js';
import * as auditRepo from './audit.js';
import { getDb } from '../db/index.js';
import { roles, roleAssignments } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export interface LegacyRoleMapping {
  /** The legacy role value from app_metadata.role */
  legacyRole: string;
  /** The SupaOAuth role name to map to */
  supaoauthRole: string;
  /** Description of what this mapping does */
  description?: string;
}

export interface MigrationPolicy {
  /** Mapping table from legacy roles to SupaOAuth roles */
  mappings: LegacyRoleMapping[];
  /** Whether to actually apply changes (false = dry-run) */
  dryRun: boolean;
  /** If true, creates missing SupaOAuth roles automatically */
  autoCreateRoles: boolean;
  /** If true, preserves the original app_metadata.role after migration */
  preserveLegacyRole: boolean;
  /** Maximum users to process in a single run (safety limit) */
  batchSize: number;
}

export interface MigrationResult {
  total: number;
  migrated: number;
  skipped: number;
  errors: number;
  details: Array<{
    userId: string;
    legacyRole: string;
    targetRole: string;
    status: 'migrated' | 'skipped' | 'error';
    error?: string;
  }>;
  dryRun: boolean;
}

/**
 * Build a default migration policy based on known SupaCloud business roles.
 * These defaults map seagoo-ai style roles to SupaOAuth equivalents.
 */
export function buildDefaultPolicy(): MigrationPolicy {
  return {
    mappings: [
      { legacyRole: 'admin', supaoauthRole: 'admin', description: 'Full system administrator' },
      { legacyRole: 'fa_expert', supaoauthRole: 'fa_expert', description: 'Financial audit expert' },
      { legacyRole: 'operator', supaoauthRole: 'operator', description: 'System operator' },
      { legacyRole: 'inspector', supaoauthRole: 'inspector', description: 'Data inspector' },
      { legacyRole: 'authenticated', supaoauthRole: 'authenticated', description: 'Default authenticated user' },
    ],
    dryRun: true,
    autoCreateRoles: true,
    preserveLegacyRole: true,
    batchSize: 100,
  };
}

/**
 * Ensure all mapped SupaOAuth roles exist in the database.
 * Returns list of created role names.
 */
export async function ensureRolesExist(policy: MigrationPolicy): Promise<string[]> {
  const db = getDb();
  const created: string[] = [];

  for (const mapping of policy.mappings) {
    const existing = await db.select().from(roles).where(eq(roles.name, mapping.supaoauthRole)).limit(1);
    if (existing.length === 0 && policy.autoCreateRoles) {
      await db.insert(roles).values({
        name: mapping.supaoauthRole,
        description: mapping.description || `Migrated from legacy role: ${mapping.legacyRole}`,
      });
      created.push(mapping.supaoauthRole);
    }
  }

  return created;
}

/**
 * Import users' legacy roles into SupaOAuth.
 * Reads app_metadata.role from GoTrue, maps to SupaOAuth role assignments.
 * In dry-run mode, only reports what would be done.
 */
export async function importLegacyRoles(policy: MigrationPolicy): Promise<MigrationResult> {
  const adapter = getSupaCloudAdapter();
  const db = getDb();
  const result: MigrationResult = {
    total: 0,
    migrated: 0,
    skipped: 0,
    errors: 0,
    details: [],
    dryRun: policy.dryRun,
  };

  // Build lookup: legacyRole → supaoauthRole
  const mappingLookup = new Map(policy.mappings.map(m => [m.legacyRole, m.supaoauthRole]));

  // Fetch all users from GoTrue
  const usersResponse = await adapter.listUsers() as Record<string, unknown>;
  const users = Array.isArray(usersResponse) ? usersResponse : (usersResponse.users as unknown[]) || [];

  result.total = Math.min(users.length, policy.batchSize);

  for (let i = 0; i < result.total; i++) {
    const user = users[i] as Record<string, unknown>;
    const userId = user.id as string;
    const appMetadata = (user.app_metadata as Record<string, unknown>) || {};
    const legacyRole = (appMetadata.role as string) || '';

    if (!legacyRole || !mappingLookup.has(legacyRole)) {
      result.details.push({
        userId,
        legacyRole: legacyRole || '(none)',
        targetRole: '(no mapping)',
        status: 'skipped',
      });
      result.skipped++;
      continue;
    }

    const targetRoleName = mappingLookup.get(legacyRole)!;

    if (policy.dryRun) {
      result.details.push({
        userId,
        legacyRole,
        targetRole: targetRoleName,
        status: 'migrated',
      });
      result.migrated++;
      continue;
    }

    try {
      // Find the SupaOAuth role
      const roleRows = await db.select().from(roles).where(eq(roles.name, targetRoleName)).limit(1);
      if (roleRows.length === 0) {
        result.details.push({
          userId,
          legacyRole,
          targetRole: targetRoleName,
          status: 'error',
          error: `SupaOAuth role "${targetRoleName}" not found`,
        });
        result.errors++;
        continue;
      }

      // Check if assignment already exists
      const existing = await db.select().from(roleAssignments)
        .where(eq(roleAssignments.userId, userId))
        .limit(100);

      const alreadyAssigned = existing.some(a => a.roleId === roleRows[0].id && !a.organizationId);
      if (alreadyAssigned) {
        result.details.push({
          userId,
          legacyRole,
          targetRole: targetRoleName,
          status: 'skipped',
        });
        result.skipped++;
        continue;
      }

      // Create role assignment at user level (no org)
      await db.insert(roleAssignments).values({
        roleId: roleRows[0].id,
        userId,
        organizationId: null,
        applicationId: null,
      });

      result.details.push({
        userId,
        legacyRole,
        targetRole: targetRoleName,
        status: 'migrated',
      });
      result.migrated++;
    } catch (e) {
      result.details.push({
        userId,
        legacyRole,
        targetRole: targetRoleName,
        status: 'error',
        error: (e as Error).message,
      });
      result.errors++;
    }
  }

  // Audit the migration
  await auditRepo.logAudit({
    eventType: policy.dryRun ? 'rbac_bridge.import_dry_run' : 'rbac_bridge.import',
    resourceType: 'rbac_migration',
    resourceId: 'legacy_role_import',
    actorType: 'admin',
    details: {
      total: result.total,
      migrated: result.migrated,
      skipped: result.skipped,
      errors: result.errors,
      dryRun: policy.dryRun,
      mappings: policy.mappings,
    },
  });

  return result;
}

/**
 * Generate a helper SQL snippet that bridges app_metadata.supaoauth.roles
 * for apps that still read app_metadata.role. This can be applied to the
 * tenant DB to create a compatibility view.
 */
export function generateCompatibilityHelper(projectRef: string): string {
  return `-- P0-28 RBAC Compatibility Helper for project ${projectRef}
-- This function bridges SupaOAuth roles to legacy app_metadata.role
-- for backward compatibility with existing SupaCloud business apps.

CREATE OR REPLACE FUNCTION supaoauth.legacy_role_for_user(user_id UUID)
RETURNS TEXT AS $$
DECLARE
  legacy_role TEXT;
  supaoauth_roles TEXT[];
BEGIN
  -- Read supaoauth roles from the most recent role assignment
  SELECT array_agg(r.name) INTO supaoauth_roles
  FROM supaoauth.role_assignments ra
  JOIN supaoauth.roles r ON r.id = ra.role_id
  WHERE ra.user_id = legacy_role_for_user.user_id
    AND ra.organization_id IS NULL;

  -- Map supaoauth roles to legacy role priority
  IF supaoauth_roles @> ARRAY['admin'] THEN
    legacy_role := 'admin';
  ELSIF supaoauth_roles @> ARRAY['fa_expert'] THEN
    legacy_role := 'fa_expert';
  ELSIF supaoauth_roles @> ARRAY['operator'] THEN
    legacy_role := 'operator';
  ELSIF supaoauth_roles @> ARRAY['inspector'] THEN
    legacy_role := 'inspector';
  ELSE
    legacy_role := 'authenticated';
  END IF;

  RETURN legacy_role;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Example usage in RLS policy:
-- CREATE POLICY "legacy_role_check" ON some_table
--   USING (supaoauth.legacy_role_for_user(auth.uid()) = 'admin');
`;
}
