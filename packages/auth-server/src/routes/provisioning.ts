// Provisioning routes (P0-20) with OpenAPI annotations
// SupaCloud project provisioning and idempotent reconcile

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as provRepo from '../repositories/provisioning.js';
import * as auditRepo from '../repositories/audit.js';
import { runMigration } from '../db/migrate.js';

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  try { await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details }); } catch {}
}

export const provisioningRoutes = new Elysia({ prefix: '/v1/provisioning' })
  .get('/:projectRef', async ({ params }) => {
    const steps = await provRepo.getProjectProvisioning(params.projectRef);
    const fullyProvisioned = await provRepo.isProjectFullyProvisioned(params.projectRef);
    return { project_ref: params.projectRef, steps, fully_provisioned: fullyProvisioned };
  }, {
    detail: { summary: 'Get provisioning status for a project', tags: ['Provisioning'] },
  })

  .post('/:projectRef/reconcile', async ({ params }) => {
    const projectRef = params.projectRef;
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

    // Step 2: GoTrue config verification
    try {
      const adapter = getSupaCloudAdapter();
      await adapter.getAuthConfig();
      await provRepo.recordStep(projectRef, { step: 'gotrue_config', status: 'completed' });
      results.push({ step: 'gotrue_config', status: 'completed' });
    } catch (e) {
      await provRepo.recordStep(projectRef, { step: 'gotrue_config', status: 'failed', details: { error: (e as Error).message } });
      results.push({ step: 'gotrue_config', status: 'failed', details: { error: (e as Error).message } });
    }

    // Step 3: Kong routes verification
    try {
      const adapter = getSupaCloudAdapter();
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

    // Step 4: Storage buckets creation
    try {
      const adapter = getSupaCloudAdapter();
      // Ensure required buckets exist
      try { await adapter.createStorageBucket('avatars', { public: false }); } catch { /* already exists */ }
      try { await adapter.createStorageBucket('branding', { public: true }); } catch { /* already exists */ }
      await provRepo.recordStep(projectRef, { step: 'storage_buckets', status: 'completed' });
      results.push({ step: 'storage_buckets', status: 'completed' });
    } catch (e) {
      await provRepo.recordStep(projectRef, { step: 'storage_buckets', status: 'failed', details: { error: (e as Error).message } });
      results.push({ step: 'storage_buckets', status: 'failed', details: { error: (e as Error).message } });
    }

    await audit('provisioning.reconcile', 'project', projectRef, { results });

    const fullyProvisioned = await provRepo.isProjectFullyProvisioned(projectRef);
    return { project_ref: projectRef, results, fully_provisioned: fullyProvisioned };
  }, {
    detail: {
      summary: 'Idempotent provision/reconcile for a project',
      description: 'Runs DB migration, verifies GoTrue config, Kong routes, and storage buckets. Repeated execution does not drift.',
      tags: ['Provisioning'],
    },
  })

  .post('/:projectRef/rollback', async ({ params }) => {
    const projectRef = params.projectRef;
    await provRepo.resetProjectProvisioning(projectRef);
    await audit('provisioning.rollback', 'project', projectRef);
    return { project_ref: projectRef, status: 'provisioning_records_reset' };
  }, {
    detail: { summary: 'Reset provisioning records for rollback', tags: ['Provisioning'] },
  });
