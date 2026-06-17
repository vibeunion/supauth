// Employee status sync scheduler.
// Reconciles provisioning record source_status with GoTrue user state:
// - active/正常 → ensure user is not suspended
// - non-active  → suspend user in GoTrue
// Also supports incremental sync via the `/v1/account-provisioning/sync` API.

import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as accountProvisioning from '../repositories/account-provisioning.js';
import * as auditRepo from '../repositories/audit.js';

const adapter = getSupaCloudAdapter();

export interface EmployeeStatusSyncInput {
  records: Array<{
    external_id: string;
    source_status: string;
    display_name?: string;
    email?: string;
  }>;
  external_type?: string;
  suspend_users?: boolean;
  reactivate_users?: boolean;
  dry_run?: boolean;
}

export interface EmployeeStatusSyncResult {
  total: number;
  unchanged: number;
  updated: number;
  suspended: number;
  reactivated: number;
  errors: Array<{ external_id: string; error: string }>;
}

const ACTIVE_STATUSES = new Set(['active', '正常']);

async function audit(eventType: string, resourceId: string, details?: Record<string, unknown>) {
  try {
    await auditRepo.logAudit({
      eventType,
      actorType: 'system',
      resourceType: 'account_provisioning_record',
      resourceId,
      details,
    });
  } catch {}
}

/**
 * Sync a batch of employee status changes.
 * For each record:
 * 1. Find the existing provisioning record by external_id
 * 2. If source_status changed, update the provisioning record
 * 3. If suspend_users and status is non-active, suspend the GoTrue user
 * 4. If reactivate_users and status changed to active, unsuspend the GoTrue user
 */
export async function syncEmployeeStatuses(input: EmployeeStatusSyncInput): Promise<EmployeeStatusSyncResult> {
  const result: EmployeeStatusSyncResult = {
    total: input.records.length,
    unchanged: 0,
    updated: 0,
    suspended: 0,
    reactivated: 0,
    errors: [],
  };

  const externalType = input.external_type || 'employee';
  const suspendUsers = input.suspend_users !== false;
  const reactivateUsers = input.reactivate_users === true;
  const dryRun = input.dry_run === true;

  for (const record of input.records) {
    const externalId = accountProvisioning.normalizeExternalId(record.external_id);
    if (!externalId) {
      result.errors.push({ external_id: record.external_id, error: 'empty external_id' });
      continue;
    }

    try {
      const existing = await accountProvisioning.findRecordByExternalId(externalId, externalType);
      if (!existing) {
        result.errors.push({ external_id: externalId, error: 'provisioning record not found' });
        continue;
      }

      const newStatus = record.source_status || 'active';
      const wasActive = ACTIVE_STATUSES.has(existing.sourceStatus);
      const isActive = ACTIVE_STATUSES.has(newStatus);

      if (existing.sourceStatus === newStatus) {
        result.unchanged += 1;
        continue;
      }

      if (dryRun) {
        result.updated += 1;
        if (!isActive && wasActive) result.suspended += 1;
        if (isActive && !wasActive) result.reactivated += 1;
        continue;
      }

      // Update the provisioning record
      await accountProvisioning.updateRecordSourceStatus(existing.id, newStatus);
      result.updated += 1;

      // Sync to GoTrue user
      if (!isActive && wasActive && suspendUsers && existing.userId) {
        try {
          await adapter.suspendUser(existing.userId, {
            reason: 'employee_status_sync',
            source_status: newStatus,
          });
          result.suspended += 1;
          await audit('employee_status.suspended', `${externalType}:${externalId}`, {
            email: existing.email,
            source_status: newStatus,
          });
        } catch (e) {
          result.errors.push({
            external_id: externalId,
            error: `suspend failed: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      } else if (isActive && !wasActive && reactivateUsers && existing.userId) {
        try {
          await adapter.unsuspendUser(existing.userId);
          result.reactivated += 1;
          await audit('employee_status.reactivated', `${externalType}:${externalId}`, {
            email: existing.email,
            source_status: newStatus,
          });
        } catch (e) {
          result.errors.push({
            external_id: externalId,
            error: `reactivate failed: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }
    } catch (e) {
      result.errors.push({
        external_id: externalId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  await audit('employee_status.sync', 'batch', {
    total: result.total,
    updated: result.updated,
    suspended: result.suspended,
    reactivated: result.reactivated,
    error_count: result.errors.length,
    dry_run: dryRun,
  });

  return result;
}

/**
 * Full reconciliation: scan all provisioning records and ensure GoTrue user
 * state matches source_status. Called by the scheduled job.
 */
export async function reconcileAllEmployeeStatuses(options?: {
  externalType?: string;
  dryRun?: boolean;
  batchSize?: number;
}): Promise<EmployeeStatusSyncResult> {
  const externalType = options?.externalType || 'employee';
  const batchSize = options?.batchSize || 500;
  const dryRun = options?.dryRun ?? false;

  const aggregate: EmployeeStatusSyncResult = {
    total: 0,
    unchanged: 0,
    updated: 0,
    suspended: 0,
    reactivated: 0,
    errors: [],
  };

  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const records = await accountProvisioning.listRecordsForSync({
      externalType,
      limit: batchSize,
      offset,
    });
    if (records.length === 0) break;

    for (const record of records) {
      const isActive = ACTIVE_STATUSES.has(record.sourceStatus);
      if (!record.userId) {
        // No GoTrue user linked, skip
        aggregate.unchanged += 1;
        continue;
      }

      try {
        // Check if the GoTrue user state matches
        const user = await adapter.getUser(record.userId) as Record<string, unknown> | null;
        if (!user) {
          aggregate.unchanged += 1;
          continue;
        }

        const isSuspended = user.banned_until !== undefined && user.banned_until !== null;
        const shouldSuspend = !isActive;
        const shouldReactivate = isActive && isSuspended;

        if (shouldSuspend && !isSuspended) {
          if (!dryRun) {
            await adapter.suspendUser(record.userId, {
              reason: 'employee_status_reconcile',
              source_status: record.sourceStatus,
            });
            await audit('employee_status.reconcile_suspended', `${externalType}:${record.externalId}`, {
              email: record.email,
              source_status: record.sourceStatus,
            });
          }
          aggregate.suspended += 1;
          aggregate.updated += 1;
        } else if (shouldReactivate) {
          if (!dryRun) {
            await adapter.unsuspendUser(record.userId);
            await audit('employee_status.reconcile_reactivated', `${externalType}:${record.externalId}`, {
              email: record.email,
              source_status: record.sourceStatus,
            });
          }
          aggregate.reactivated += 1;
          aggregate.updated += 1;
        } else {
          aggregate.unchanged += 1;
        }
      } catch (e) {
        aggregate.errors.push({
          external_id: record.externalId,
          error: e instanceof Error ? e.message : String(e),
        });
      }

      aggregate.total += 1;
    }

    if (records.length < batchSize) break;
    offset += batchSize;
  }

  return aggregate;
}
