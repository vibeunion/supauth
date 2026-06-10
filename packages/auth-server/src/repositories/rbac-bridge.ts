// P0-28: RBAC compatibility bridge for existing SupaCloud business apps.
// Provides tools to map legacy app_metadata.role values to SupaOAuth
// roles/permissions, with dry-run and rollback support.

import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as roleRepo from './roles.js';
import * as auditRepo from './audit.js';

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

function listItems(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.items)) return record.items as Array<Record<string, unknown>>;
    if (Array.isArray(record.users)) return record.users as Array<Record<string, unknown>>;
    if (Array.isArray(record.roles)) return record.roles as Array<Record<string, unknown>>;
    if (Array.isArray(record.assignments)) return record.assignments as Array<Record<string, unknown>>;
  }
  return [];
}

function getStringField(record: Record<string, unknown>, fields: string[]) {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '';
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
 * Ensure all mapped SupaOAuth roles exist in SupaCloud RBAC.
 * Returns list of created role names.
 */
export async function ensureRolesExist(policy: MigrationPolicy): Promise<string[]> {
  const existingRoles = listItems(await roleRepo.listRoles());
  const existingNames = new Set(existingRoles.map(role => getStringField(role, ['name', 'role_name'])).filter(Boolean));
  const created: string[] = [];

  for (const mapping of policy.mappings) {
    if (!existingNames.has(mapping.supaoauthRole) && policy.autoCreateRoles) {
      await roleRepo.createRole({
        name: mapping.supaoauthRole,
        description: mapping.description || `Migrated from legacy role: ${mapping.legacyRole}`,
      });
      created.push(mapping.supaoauthRole);
      existingNames.add(mapping.supaoauthRole);
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
  const users = listItems(await adapter.listUsers());
  const rolesByName = new Map<string, Record<string, unknown>>();
  for (const role of listItems(await roleRepo.listRoles())) {
    const name = getStringField(role, ['name', 'role_name']);
    if (name) rolesByName.set(name, role);
  }

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
      const targetRole = rolesByName.get(targetRoleName);
      const targetRoleId = targetRole ? getStringField(targetRole, ['id', 'role_id']) : '';
      if (!targetRoleId) {
        result.details.push({
          userId,
          legacyRole,
          targetRole: targetRoleName,
          status: 'error',
          error: `SupaCloud RBAC role "${targetRoleName}" not found`,
        });
        result.errors++;
        continue;
      }

      const existing = listItems(await roleRepo.getUserRoleAssignments(userId));
      const alreadyAssigned = existing.some((assignment) => {
        const roleId = getStringField(assignment, ['roleId', 'role_id']);
        const organizationId = getStringField(assignment, ['organizationId', 'organization_id']);
        return roleId === targetRoleId && !organizationId;
      });
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

      await roleRepo.assignRole({
        roleId: targetRoleId,
        userId,
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
	  -- Read the SupaCloud-owned RBAC projection synced into GoTrue metadata.
	  SELECT COALESCE(array_agg(value), ARRAY[]::TEXT[]) INTO supaoauth_roles
	  FROM auth.users u,
	       jsonb_array_elements_text(COALESCE(u.raw_app_meta_data -> 'supaoauth' -> 'roles', '[]'::jsonb)) AS value
	  WHERE u.id = legacy_role_for_user.user_id;

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
