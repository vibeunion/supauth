// P0-28: RBAC compatibility bridge for existing SupaCloud business apps.
// Provides tools to map legacy app_metadata.role values to SupaOAuth
// roles/permissions, with dry-run and rollback support.

import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as roleRepo from './roles.js';
import * as auditRepo from './audit.js';
import { Type, decodeSchema, type Static, type TSchema } from '../../../shared/src/schema.js';
import {
  LegacyRoleMappingSchema, RbacMigrationPolicySchema, RbacMigrationResultSchema,
} from '../../../shared/src/server-operations.js';
import { ApiContractError } from '../utils/api-contract.js';

export type LegacyRoleMapping = Static<typeof LegacyRoleMappingSchema>;
export type MigrationPolicy = Static<typeof RbacMigrationPolicySchema>;
export type MigrationResult = Static<typeof RbacMigrationResultSchema>;
const optionalString = Type.Optional(Type.Union([Type.String(), Type.Null()]));
const migrationUserSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  app_metadata: Type.Optional(Type.Union([
    Type.Object({ role: optionalString }),
    Type.Null(),
  ])),
});
const migrationRoleSchema = Type.Object({
  id: optionalString, role_id: optionalString,
  name: optionalString, role_name: optionalString,
});
const migrationAssignmentSchema = Type.Object({
  roleId: optionalString, role_id: optionalString,
  organizationId: optionalString, organization_id: optionalString,
});

function invalidInventory(): ApiContractError {
  return new ApiContractError(502, 'invalid_upstream_response', 'RBAC inventory does not match the expected contract');
}

function listItems<S extends TSchema>(value: unknown, itemSchema: S): Static<S>[] {
  const itemsSchema = Type.Array(itemSchema);
  try {
    if (Array.isArray(value)) return decodeSchema(itemsSchema, value);
    const envelope = decodeSchema(Type.Object({
      items: Type.Optional(itemsSchema),
      users: Type.Optional(itemsSchema),
      roles: Type.Optional(itemsSchema),
      assignments: Type.Optional(itemsSchema),
    }), value);
    const items = envelope.items ?? envelope.users ?? envelope.roles ?? envelope.assignments;
    if (items !== undefined) return items;
  } catch {
    throw invalidInventory();
  }
  throw invalidInventory();
}

function requiredAlias(primary: string | null | undefined, legacy: string | null | undefined): string {
  const value = primary || legacy;
  if (!value) throw invalidInventory();
  return value;
}

interface MigrationRole {
  id: string;
  name: string;
}

interface MigrationAssignment {
  roleId: string;
  organizationId: string | null;
}

interface MigrationEntry {
  userId: string;
  legacyRole: string;
  targetRoleName: string | null;
  assignments: MigrationAssignment[];
}

async function preflightMigration(policy: MigrationPolicy) {
  const users = listItems(await getSupaCloudAdapter().listUsers(), migrationUserSchema);
  const roles = listItems(await roleRepo.listRoles(), migrationRoleSchema).map((role): MigrationRole => ({
    id: requiredAlias(role.id, role.role_id),
    name: requiredAlias(role.name, role.role_name),
  }));
  const mappings = new Map(policy.mappings.map(mapping => [mapping.legacyRole, mapping.supaoauthRole]));
  const assignmentsByUser = new Map<string, MigrationAssignment[]>();
  const entries: MigrationEntry[] = [];
  const total = Math.min(users.length, policy.batchSize);

  // 全批预检必须在第一笔写入或审计之前完成，不能边校验边赋权。
  for (let index = 0; index < total; index++) {
    const user = users[index];
    if (!user) throw invalidInventory();
    const legacyRole = user.app_metadata?.role || '';
    const targetRoleName = mappings.get(legacyRole) ?? null;
    let assignments: MigrationAssignment[] = [];
    if (targetRoleName !== null) {
      const cached = assignmentsByUser.get(user.id);
      if (cached) {
        assignments = cached;
      } else {
        assignments = listItems(
          await roleRepo.getUserRoleAssignments(user.id), migrationAssignmentSchema,
        ).map(assignment => ({
          roleId: requiredAlias(assignment.roleId, assignment.role_id),
          organizationId: assignment.organizationId || assignment.organization_id || null,
        }));
        assignmentsByUser.set(user.id, assignments);
      }
    }
    entries.push({ userId: user.id, legacyRole, targetRoleName, assignments });
  }
  return { roles, entries, total };
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
  const { roles } = await preflightMigration(policy);
  const existingNames = new Set(roles.map(role => role.name));
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
  const { roles, entries, total } = await preflightMigration(policy);
  const rolesByName = new Map(roles.map(role => [role.name, role]));
  const result: MigrationResult = {
    total,
    migrated: 0,
    skipped: 0,
    errors: 0,
    details: [],
    dryRun: policy.dryRun,
  };
  const attemptedAssignments = new Map<string, Set<string>>();

  for (const { userId, legacyRole, targetRoleName, assignments } of entries) {
    if (!legacyRole || targetRoleName === null) {
      result.details.push({
        userId,
        legacyRole: legacyRole || '(none)',
        targetRole: '(no mapping)',
        status: 'skipped',
      });
      result.skipped++;
      continue;
    }

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
      if (!targetRole) {
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

      const targetRoleId = targetRole.id;
      const alreadyAssigned = assignments.some(assignment =>
        assignment.roleId === targetRoleId && !assignment.organizationId);
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

      const attemptedRoles = attemptedAssignments.get(userId) ?? new Set<string>();
      if (attemptedRoles.has(targetRoleId)) {
        throw new Error('Role assignment was already attempted; verify its outcome before retrying');
      }
      attemptedRoles.add(targetRoleId);
      attemptedAssignments.set(userId, attemptedRoles);
      await roleRepo.assignRole({
        roleId: targetRoleId,
        userId,
      });
      assignments.push({ roleId: targetRoleId, organizationId: null });

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
        error: e instanceof Error ? e.message : 'Role assignment failed',
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
 * Generate a helper SQL snippet that bridges the current project's
 * app_metadata.supaoauth.projects[projectRef].roles for apps that still read
 * app_metadata.role. This can be applied to the tenant DB as a compatibility view.
 */
export function generateCompatibilityHelper(projectRef: string): string {
  const sqlProjectRef = projectRef.replace(/'/g, "''");
  const commentProjectRef = projectRef.replace(/[\r\n]/g, ' ');
  return `-- P0-28 RBAC Compatibility Helper for project ${commentProjectRef}
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
	       jsonb_array_elements_text(COALESCE(
	         u.raw_app_meta_data -> 'supaoauth' -> 'projects' -> '${sqlProjectRef}' -> 'roles',
	         '[]'::jsonb
	       )) AS value
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
