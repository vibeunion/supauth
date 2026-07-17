// Metadata sync — pushes SupaOAuth role/org/permission data into GoTrue app_metadata
// Uses SupaCloud adapter to update user records; failures are logged to audit
// P0-27: Safe merge — reads existing app_metadata first, only patches the
// `supaoauth` namespace without clobbering `role`, `provider`, or other fields.

import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as auditRepo from '../repositories/audit.js';
import { getConfig } from '../config/index.js';

export interface SyncResult {
  success: boolean;
  userId: string;
  appMetadataPatch: Record<string, unknown>;
  preservedFields?: string[];
  error?: string;
}

export const MAX_JWT_PERMISSION_PROJECTION = 256;
export const MAX_JWT_ROLE_PROJECTION = 64;

export interface SupaOAuthRbacProjectionInput {
  roles: string[];
  permissions: string[];
  version?: number;
  applicationId?: string;
  currentOrgId?: string;
  currentOrgRole?: string;
}

function getItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: unknown[] }).items;
  }
  return [];
}

function getNamedItems(value: unknown, key: string): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return [];
  const direct = (value as Record<string, unknown>)[key];
  if (Array.isArray(direct)) return direct.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  return [];
}

function getNames(value: unknown, key: string): string[] {
  if (!value || typeof value !== 'object') return [];
  const direct = (value as Record<string, unknown>)[key];
  if (!Array.isArray(direct)) return [];
  return direct
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') return (item as Record<string, unknown>).name;
      return null;
    })
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

export function buildSupaoauthRbacProjection(input: SupaOAuthRbacProjectionInput): Record<string, unknown> {
  const roles = uniqueStrings(input.roles);
  const permissions = uniqueStrings(input.permissions);
  const version = input.version ?? Date.now();
  const roleProjectionFits = roles.length <= MAX_JWT_ROLE_PROJECTION;
  const permissionProjectionFits = permissions.length <= MAX_JWT_PERMISSION_PROJECTION;

  const supaoauth: Record<string, unknown> = {
    roles: roleProjectionFits ? roles : [],
    rbac_version: version,
    roles_count: roles.length,
    permissions_version: version,
    permissions_count: permissions.length,
    permissions: permissionProjectionFits ? permissions : [],
  };

  if (input.applicationId) {
    supaoauth.application_id = input.applicationId;
  }

  if (!roleProjectionFits) {
    supaoauth.roles_truncated = true;
    supaoauth.roles_projection_limit = MAX_JWT_ROLE_PROJECTION;
  }

  if (!permissionProjectionFits) {
    supaoauth.permissions_truncated = true;
    supaoauth.permissions_projection_limit = MAX_JWT_PERMISSION_PROJECTION;
  }

  if (input.currentOrgId) {
    supaoauth.current_org_id = input.currentOrgId;
    supaoauth.current_org_role = input.currentOrgRole || 'member';
  }

  return supaoauth;
}

/** Build the supaoauth namespace value from resolved roles/org. */
async function buildSupaoauthNamespace(
  userId: string,
  orgId?: string,
  applicationId?: string,
): Promise<Record<string, unknown>> {
  const adapter = getSupaCloudAdapter();
  const resolved = await adapter.resolveUserPermissions(userId, orgId, applicationId);
  let currentOrgRole: string | undefined;

  if (orgId) {
    const assignments = getItems(await adapter.getOrgRoleAssignments(orgId)) as Array<Record<string, unknown>>;
    const userAssignment = assignments.find((assignment) => {
      const matchesUser = assignment.userId === userId || assignment.user_id === userId;
      const assignedApplicationId = assignment.applicationId || assignment.application_id;
      const matchesApplication = !applicationId || !assignedApplicationId || assignedApplicationId === applicationId;
      return matchesUser && matchesApplication;
    });
    const role = userAssignment?.role && typeof userAssignment.role === 'object'
      ? userAssignment.role as Record<string, unknown>
      : null;
    currentOrgRole = typeof role?.name === 'string'
      ? role.name
      : typeof userAssignment?.role_name === 'string'
        ? userAssignment.role_name
        : 'member';
  }

  return buildSupaoauthRbacProjection({
    roles: getNames(resolved, 'roles'),
    permissions: getNames(resolved, 'permissions'),
    applicationId,
    currentOrgId: orgId,
    currentOrgRole,
  });
}

/**
 * P0-27: Read-modify-write for app_metadata.
 * 1. Read the user's current app_metadata from GoTrue.
 * 2. Merge only the `supaoauth` namespace.
 * 3. Write back the full merged app_metadata.
 * 4. Verify that non-supaoauth fields are preserved.
 */
export async function syncUserMetadata(userId: string, orgId?: string, applicationId?: string): Promise<SyncResult> {
  const config = getConfig();
  if (config.runtimeMode !== 'gotrue') {
    return { success: true, userId, appMetadataPatch: {} };
  }

  const adapter = getSupaCloudAdapter();

  try {
    // Step 1: Read existing user from GoTrue
    const existingUser = await adapter.getUser(userId) as Record<string, unknown>;
    const existingAppMetadata = (existingUser.app_metadata as Record<string, unknown>) || {};

    // Step 2: Build the new supaoauth namespace
    const newSupaoauth = await buildSupaoauthNamespace(userId, orgId, applicationId);
    const existingSupaoauth = existingAppMetadata.supaoauth && typeof existingAppMetadata.supaoauth === 'object'
      ? existingAppMetadata.supaoauth as Record<string, unknown>
      : {};
    const existingApplications = existingSupaoauth.applications && typeof existingSupaoauth.applications === 'object'
      ? existingSupaoauth.applications as Record<string, unknown>
      : {};
    const mergedSupaoauth = applicationId
      ? {
          ...existingSupaoauth,
          applications: {
            ...existingApplications,
            [applicationId]: newSupaoauth,
          },
          rbac_synced_at: new Date().toISOString(),
        }
      : {
          ...newSupaoauth,
          ...(Object.keys(existingApplications).length > 0 ? { applications: existingApplications } : {}),
          rbac_synced_at: new Date().toISOString(),
        };

    // Step 3: Deep-merge — only replace `supaoauth` key, preserve everything else
    const mergedAppMetadata: Record<string, unknown> = {
      ...existingAppMetadata,
      supaoauth: mergedSupaoauth,
    };

    // Step 4: Verify critical fields are preserved
    const preservedFields = ['role', 'provider', 'providers', 'tenant_id', 'parent'];
    for (const field of preservedFields) {
      if (field in existingAppMetadata && existingAppMetadata[field] !== undefined) {
        if (mergedAppMetadata[field] !== existingAppMetadata[field]) {
          throw new Error(`Merge safety violation: field "${field}" was clobbered during sync`);
        }
      }
    }

    // Step 5: Write back
    await adapter.updateUser(userId, {
      app_metadata: mergedAppMetadata,
    });
    const preservedFieldsPresent = preservedFields.filter(f => f in existingAppMetadata);

    await auditRepo.logAudit({
      eventType: 'sync.user_metadata',
      resourceType: 'user',
      resourceId: userId,
      actorType: 'system',
      details: { orgId, applicationId, roles: newSupaoauth.roles, preserved_fields: preservedFieldsPresent },
    });

    return {
      success: true,
      userId,
      appMetadataPatch: { supaoauth: mergedSupaoauth },
      preservedFields: preservedFieldsPresent,
    };
  } catch (e) {
    const error = (e as Error).message;
    await auditRepo.logAudit({
      eventType: 'sync.user_metadata_failed',
      resourceType: 'user',
      resourceId: userId,
      actorType: 'system',
      details: { orgId, applicationId, error },
    });
    return { success: false, userId, appMetadataPatch: {}, error };
  }
}

/** Sync all members of an organization (batch) */
export async function syncOrgMetadata(orgId: string): Promise<SyncResult[]> {
  const adapter = getSupaCloudAdapter();
  const assignments = getItems(await adapter.getOrgRoleAssignments(orgId)) as Array<Record<string, unknown>>;
  const userIds = [...new Set(assignments
    .map((assignment) => assignment.userId || assignment.user_id)
    .filter((userId): userId is string => typeof userId === 'string' && userId.length > 0))];
  const results: SyncResult[] = [];

  for (const userId of userIds) {
    const result = await syncUserMetadata(userId, orgId);
    results.push(result);
  }

  return results;
}

/** Schedule a sync retry for a failed user metadata update. */
export async function scheduleSyncRetry(userId: string, orgId?: string, delayMs: number = 30_000): Promise<void> {
  setTimeout(async () => {
    const result = await syncUserMetadata(userId, orgId);
    if (!result.success) {
      await auditRepo.logAudit({
        eventType: 'sync.retry_failed',
        resourceType: 'user',
        resourceId: userId,
        actorType: 'system',
        details: { orgId, error: result.error },
      });
    }
  }, delayMs);
}
