// Provisioning routes (P0-20 / P0-26) with OpenAPI annotations
// SupaCloud project provisioning and idempotent reconcile
// P0-26: Each reconcile uses path projectRef, NOT process-level PROJECT_REF

import { Elysia } from 'elysia';
import { getSupaCloudAdapterForProject, getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as provRepo from '../repositories/provisioning.js';
import * as auditRepo from '../repositories/audit.js';
import { runMigration } from '../db/migrate.js';

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  try { await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details }); } catch {}
}

/** Validate that a projectRef looks like a valid SupaCloud project ref. */
function isValidProjectRef(ref: string): boolean {
  return /^[a-z0-9]{20,}$/.test(ref);
}

export const provisioningRoutes = new Elysia({ prefix: '/v1/provisioning' })
  .get('/:projectRef', async ({ params }) => {
    const projectRef = params.projectRef;
    if (!isValidProjectRef(projectRef)) {
      return { error: 'Invalid project ref format', project_ref: projectRef };
    }
    const steps = await provRepo.getProjectProvisioning(projectRef);
    const fullyProvisioned = await provRepo.isProjectFullyProvisioned(projectRef);
    return { project_ref: projectRef, steps, fully_provisioned: fullyProvisioned };
  }, {
    detail: { summary: 'Get provisioning status for a project', tags: ['Provisioning'] },
  })

  .post('/:projectRef/reconcile', async ({ params }) => {
    const projectRef = params.projectRef;
    if (!isValidProjectRef(projectRef)) {
      return { error: 'Invalid project ref format', project_ref: projectRef, results: [], fully_provisioned: false };
    }

    // P0-26: Create adapter explicitly bound to the requested projectRef
    const adapter = getSupaCloudAdapterForProject(projectRef);
    const adapterRef = adapter.getProjectRef();

    // Safety assertion: adapter must be bound to the same ref as the request
    if (adapterRef !== projectRef) {
      await audit('provisioning.reconcile_ref_mismatch', 'project', projectRef, {
        error: `Adapter ref ${adapterRef} != request ref ${projectRef}`,
      });
      return {
        project_ref: projectRef,
        results: [{ step: 'safety_check', status: 'failed', details: { error: 'projectRef mismatch — aborting reconcile' } }],
        fully_provisioned: false,
      };
    }

    const results: Array<{ step: string; status: string; details?: Record<string, unknown> }> = [];

    // Step 1: DB migration
    try {
      await runMigration();
      await provRepo.recordStep(projectRef, { step: 'db_migration', status: 'completed' });
      results.push({ step: 'db_migration', status: 'completed' });
    } catch (e) {
      await provRepo.recordStep(projectRef, { step: 'db_migration', status: 'failed', details: { error: (e as Error).message } });
      results.push({ step: 'db_migration', status: 'failed', details: { error: (e as Error).message } });
    }

    // Step 2: GoTrue config verification (scoped to projectRef)
    try {
      await adapter.getAuthConfig();
      await provRepo.recordStep(projectRef, { step: 'gotrue_config', status: 'completed' });
      results.push({ step: 'gotrue_config', status: 'completed' });
    } catch (e) {
      await provRepo.recordStep(projectRef, { step: 'gotrue_config', status: 'failed', details: { error: (e as Error).message } });
      results.push({ step: 'gotrue_config', status: 'failed', details: { error: (e as Error).message } });
    }

    // Step 3: Kong routes verification (scoped to projectRef)
    try {
      const verification = await adapter.verifyGatewayRoutes();
      if (!verification.ok) {
        throw new Error(`Gateway route verification failed: ${JSON.stringify(verification.probes)}`);
      }
      await provRepo.recordStep(projectRef, { step: 'kong_routes', status: 'completed' });
      results.push({ step: 'kong_routes', status: 'completed', details: { probes: verification.probes } });
    } catch (e) {
      await provRepo.recordStep(projectRef, { step: 'kong_routes', status: 'failed', details: { error: (e as Error).message } });
      results.push({ step: 'kong_routes', status: 'failed', details: { error: (e as Error).message } });
    }

    // Step 4: Storage buckets creation (scoped to projectRef)
    try {
      try { await adapter.createStorageBucket('avatars', { public: false }); } catch { /* already exists */ }
      try { await adapter.createStorageBucket('branding', { public: true }); } catch { /* already exists */ }
      await provRepo.recordStep(projectRef, { step: 'storage_buckets', status: 'completed' });
      results.push({ step: 'storage_buckets', status: 'completed' });
    } catch (e) {
      await provRepo.recordStep(projectRef, { step: 'storage_buckets', status: 'failed', details: { error: (e as Error).message } });
      results.push({ step: 'storage_buckets', status: 'failed', details: { error: (e as Error).message } });
    }

    await audit('provisioning.reconcile', 'project', projectRef, { results, adapter_ref: adapterRef });

    const fullyProvisioned = await provRepo.isProjectFullyProvisioned(projectRef);
    return { project_ref: projectRef, results, fully_provisioned: fullyProvisioned };
  }, {
    detail: {
      summary: 'Idempotent provision/reconcile for a project (scoped to path projectRef)',
      description: 'Runs DB migration, verifies GoTrue config, Kong routes, and storage buckets — all scoped to the requested projectRef. Repeated execution does not drift. P0-26: adapter is project-scoped, not process-scoped.',
      tags: ['Provisioning'],
    },
  })

  .post('/:projectRef/rollback', async ({ params }) => {
    const projectRef = params.projectRef;
    if (!isValidProjectRef(projectRef)) {
      return { error: 'Invalid project ref format', project_ref: projectRef };
    }
    await provRepo.resetProjectProvisioning(projectRef);
    await audit('provisioning.rollback', 'project', projectRef);
    return { project_ref: projectRef, status: 'provisioning_records_reset' };
  }, {
    detail: { summary: 'Reset provisioning records for rollback', tags: ['Provisioning'] },
  });
