// Metadata sync — pushes SupaOAuth role/org/permission data into GoTrue app_metadata
// Uses SupaCloud adapter to update user records; failures are logged to audit
// P0-27: Safe merge — reads existing app_metadata first, only patches the
// `supaoauth` namespace without clobbering `role`, `provider`, or other fields.

import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as roleRepo from '../repositories/roles.js';
import * as auditRepo from '../repositories/audit.js';
import { getConfig } from '../config/index.js';

export interface SyncResult {
  success: boolean;
  userId: string;
  appMetadataPatch: Record<string, unknown>;
  preservedFields?: string[];
  error?: string;
}

/** Build the supaoauth namespace value from resolved roles/org. */
async function buildSupaoauthNamespace(
  userId: string,
  orgId?: string,
): Promise<Record<string, unknown>> {
  const { roles, permissions } = await roleRepo.resolveUserPermissions(userId, orgId);

  const supaoauth: Record<string, unknown> = {
    roles: roles.map(r => r.name),
    rbac_version: Date.now(),
  };

  if (orgId) {
    const assignments = await roleRepo.getOrgRoleAssignments(orgId);
    const userAssignment = assignments.find(a => a.userId === userId);
    supaoauth.current_org_id = orgId;
    supaoauth.current_org_role = userAssignment?.role?.name || 'member';
  }

  return supaoauth;
}

/**
 * P0-27: Read-modify-write for app_metadata.
 * 1. Read the user's current app_metadata from GoTrue.
 * 2. Merge only the `supaoauth` namespace.
 * 3. Write back the full merged app_metadata.
 * 4. Verify that non-supaoauth fields are preserved.
 */
export async function syncUserMetadata(userId: string, orgId?: string): Promise<SyncResult> {
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
    const newSupaoauth = await buildSupaoauthNamespace(userId, orgId);

    // Step 3: Deep-merge — only replace `supaoauth` key, preserve everything else
    const mergedAppMetadata: Record<string, unknown> = {
      ...existingAppMetadata,
      supaoauth: newSupaoauth,
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
      details: { orgId, roles: newSupaoauth.roles, preserved_fields: preservedFieldsPresent },
    });

    return {
      success: true,
      userId,
      appMetadataPatch: { supaoauth: newSupaoauth },
      preservedFields: preservedFieldsPresent,
    };
  } catch (e) {
    const error = (e as Error).message;
    await auditRepo.logAudit({
      eventType: 'sync.user_metadata_failed',
      resourceType: 'user',
      resourceId: userId,
      actorType: 'system',
      details: { orgId, error },
    });
    return { success: false, userId, appMetadataPatch: {}, error };
  }
}

/** Sync all members of an organization (batch) */
export async function syncOrgMetadata(orgId: string): Promise<SyncResult[]> {
  const assignments = await roleRepo.getOrgRoleAssignments(orgId);
  const userIds = [...new Set(assignments.map(a => a.userId).filter((userId): userId is string => !!userId))];
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
