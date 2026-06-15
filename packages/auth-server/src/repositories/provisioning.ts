// Provisioning records repository (P0-20) — backed by SupaCloud Postgres
// Tracks SupaCloud project provisioning state for idempotent reconcile

import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { provisioningRecords } from '../db/schema.js';

export interface ProvisioningStep {
  step: string;
  status: 'pending' | 'completed' | 'failed';
  details?: Record<string, unknown>;
}

/** Get all provisioning records for a project */
export async function getProjectProvisioning(projectRef: string) {
  const db = getDb();
  return db.select().from(provisioningRecords)
    .where(eq(provisioningRecords.projectRef, projectRef))
    .orderBy(provisioningRecords.createdAt);
}

/** Upsert a provisioning step — idempotent per (projectRef, step).
 *
 * Implemented as a real Postgres INSERT ... ON CONFLICT ... DO UPDATE against
 * the unique index `uq_provisioning_records_project_step`. This is atomic, so
 * concurrent reconcile calls can no longer append duplicate step rows.
 */
export async function recordStep(projectRef: string, step: ProvisioningStep) {
  const db = getDb();
  const [record] = await db.insert(provisioningRecords).values({
    projectRef,
    step: step.step,
    status: step.status,
    details: step.details || {},
  })
    .onConflictDoUpdate({
      target: [provisioningRecords.projectRef, provisioningRecords.step],
      set: {
        status: step.status,
        details: step.details || {},
        updatedAt: new Date(),
      },
    })
    .returning();
  return record;
}

/** Update a provisioning step status */
export async function updateStepStatus(recordId: string, status: string, details?: Record<string, unknown>) {
  const db = getDb();
  const [updated] = await db.update(provisioningRecords).set({
    status,
    details: details || {},
    updatedAt: new Date(),
  }).where(eq(provisioningRecords.id, recordId)).returning();
  return updated;
}

/** Check if all required provisioning steps are completed for a project.
 * With upsert semantics, there is at most one record per (projectRef, step),
 * so we check that every required step has a completed record.
 */
export async function isProjectFullyProvisioned(projectRef: string): Promise<boolean> {
  const steps = await getProjectProvisioning(projectRef);
  const requiredSteps = ['db_migration', 'gotrue_config', 'supacloud_gateway_routes', 'storage_buckets'];
  const completed = steps.filter(s => s.status === 'completed').map(s => s.step);
  return requiredSteps.every(step => completed.includes(step));
}

/** Reset provisioning records for a project (for rollback) */
export async function resetProjectProvisioning(projectRef: string) {
  const db = getDb();
  await db.delete(provisioningRecords)
    .where(eq(provisioningRecords.projectRef, projectRef));
}
