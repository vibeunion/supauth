// Metadata sync — pushes SupaOAuth role/org/permission data into GoTrue app_metadata
// Uses SupaCloud adapter to update user records; failures are logged to audit

import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as roleRepo from '../repositories/roles.js';
import * as auditRepo from '../repositories/audit.js';
import { getConfig } from '../config/index.js';

export interface SyncResult {
  success: boolean;
  userId: string;
  appMetadataPatch: Record<string, unknown>;
  error?: string;
}

/** Sync a user's SupaOAuth roles/org to GoTrue app_metadata.
 *  In gotrue mode, writes canonical data to:
 *    - app_metadata.supaoauth.roles: string[]
 *    - app_metadata.supaoauth.current_org_id: string
 *    - app_metadata.supaoauth.current_org_role: string
 *
 *  The full permission decision stays in the Supabase DB projection through
 *  supaoauth.authorize(...), so JWTs remain small and revocation is immediate
 *  once projection tables are updated.
 */
export async function syncUserMetadata(userId: string, orgId?: string): Promise<SyncResult> {
  const config = getConfig();
  if (config.runtimeMode !== 'gotrue') {
    return { success: true, userId, appMetadataPatch: {} };
  }

  const adapter = getSupaCloudAdapter();

  try {
    const { roles, permissions } = await roleRepo.resolveUserPermissions(userId, orgId);

    const supaoauthMetadata: Record<string, unknown> = {
      roles: roles.map(r => r.name),
      rbac_version: Date.now(),
    };

    if (orgId) {
      const assignments = await roleRepo.getOrgRoleAssignments(orgId);
      const userAssignment = assignments.find(a => a.userId === userId);
      supaoauthMetadata.current_org_id = orgId;
      supaoauthMetadata.current_org_role = userAssignment?.role?.name || 'member';
    }

    const patch: Record<string, unknown> = {
      supaoauth: supaoauthMetadata,
    };

    await adapter.updateUser(userId, {
      app_metadata: patch,
    });

    await auditRepo.logAudit({
      eventType: 'sync.user_metadata',
      resourceType: 'user',
      resourceId: userId,
      actorType: 'system',
      details: { orgId, roles: roles.map(r => r.name), patch },
    });

    return { success: true, userId, appMetadataPatch: patch };
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
  const userIds = [...new Set(assignments.map(a => a.userId))];
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
