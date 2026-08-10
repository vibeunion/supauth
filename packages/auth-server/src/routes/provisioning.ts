// Provisioning routes (P0-20 / P0-26) with OpenAPI annotations
// SupaCloud project provisioning and idempotent reconcile
// P0-26: Each reconcile uses path projectRef, NOT process-level PROJECT_REF

import { Elysia } from 'elysia';
import { getSupaCloudAdapterForProject, isSupaCloudApiError } from '../supacloud/adapter.js';
import * as provRepo from '../repositories/provisioning.js';
import * as auditRepo from '../repositories/audit.js';
import { HOSTED_MIGRATIONS } from '../db/migrate.js';

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details });
}

type ProvisioningResult = {
  step: string;
  status: 'completed' | 'failed';
  details?: Record<string, unknown>;
};

function safeFailureDetails(error: unknown, extra?: Record<string, unknown>): Record<string, unknown> {
  if (isSupaCloudApiError(error)) {
    return {
      ...extra,
      error_code: 'supacloud_api_error',
      upstream_status: error.status,
    };
  }
  if (error instanceof TypeError) {
    return { ...extra, error_code: 'upstream_connection_failed' };
  }
  return { ...extra, error_code: 'provisioning_step_failed' };
}

async function recordStepSafely(
  projectRef: string,
  result: ProvisioningResult,
): Promise<ProvisioningResult> {
  try {
    await provRepo.recordStep(projectRef, {
      step: result.step,
      status: result.status,
      details: result.details,
    });
    return result;
  } catch {
    return {
      ...result,
      status: 'failed',
      details: {
        ...result.details,
        state_persistence: 'unavailable',
      },
    };
  }
}

async function runProvisioningStep(input: {
  projectRef: string;
  step: string;
  operation: () => Promise<Record<string, unknown> | void>;
  failureContext?: () => Record<string, unknown>;
}): Promise<ProvisioningResult> {
  let result: ProvisioningResult;
  try {
    const details = await input.operation();
    result = { step: input.step, status: 'completed', ...(details ? { details } : {}) };
  } catch (error) {
    result = {
      step: input.step,
      status: 'failed',
      details: safeFailureDetails(error, input.failureContext?.()),
    };
  }
  return recordStepSafely(input.projectRef, result);
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
    const targetInfo = adapter.getTargetInfo();

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

    const results: ProvisioningResult[] = [];

    let migrationName: string = HOSTED_MIGRATIONS[0]?.name || 'unknown';
    results.push(await runProvisioningStep({
      projectRef,
      step: 'db_migration',
      failureContext: () => ({ migration: migrationName }),
      operation: async () => {
        for (const migration of HOSTED_MIGRATIONS) {
          migrationName = migration.name;
          await adapter.runDatabaseMigration(migration.name, migration.sql);
        }
        return { mode: 'supacloud-management-api' };
      },
    }));

    results.push(await runProvisioningStep({ projectRef, step: 'gotrue_config', operation: async () => {
      await adapter.getAuthConfig();
    } }));

    results.push(await runProvisioningStep({ projectRef, step: 'supacloud_gateway_routes', operation: async () => {
      if (!targetInfo.runtimeProjectScoped) {
        throw new Error('Project-scoped runtime URL is not configured. Set SUPACLOUD_RUNTIME_URL_TEMPLATE with {projectRef} or use a default OAUTH_RUNTIME_URL containing PROJECT_REF.');
      }
      const verification = await adapter.verifyGatewayRoutes();
      if (!verification.ok) {
        throw new Error(`Gateway route verification failed: ${JSON.stringify(verification.probes)}`);
      }
      return { probes: verification.probes };
    } }));

    results.push(await runProvisioningStep({ projectRef, step: 'storage_buckets', operation: async () => {
      if (!targetInfo.storageProjectScoped) {
        throw new Error('Project-scoped storage URL is not configured. Set SUPACLOUD_STORAGE_URL_TEMPLATE with {projectRef} or use a default storage URL containing PROJECT_REF.');
      }
      try { await adapter.createStorageBucket('avatars', { public: false }); } catch (error) {
        if (!isSupaCloudApiError(error, [409])) throw error;
      }
      try { await adapter.createStorageBucket('branding', { public: true }); } catch (error) {
        if (!isSupaCloudApiError(error, [409])) throw error;
      }
    } }));

    try {
      await audit('provisioning.reconcile', 'project', projectRef, { results, adapter_ref: adapterRef, target: targetInfo });
    } catch {
      // Audit persistence must not replace the structured provisioning result.
    }

    let fullyProvisioned = false;
    try {
      fullyProvisioned = await provRepo.isProjectFullyProvisioned(projectRef);
    } catch {
      fullyProvisioned = false;
    }
    return { project_ref: projectRef, results, fully_provisioned: fullyProvisioned };
  }, {
    detail: {
      summary: 'Idempotent provision/reconcile for a project (scoped to path projectRef)',
      description: 'Runs SupaCloud-hosted DB migrations, verifies GoTrue config, SupaCloud gateway routes, and storage buckets — all scoped to the requested projectRef. Repeated execution does not drift. P0-26: adapter is project-scoped, not process-scoped.',
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
