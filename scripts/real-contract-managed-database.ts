#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Type, decodeSchema } from '../packages/shared/src/schema.js';
import { loadAllocationProof, allocationProofDetails } from './real-contract-allocation.js';
import { managementTransport, writeDeploymentEvidence } from './real-contract-deploy.js';
import { createRealContractInstaller } from './real-contract-install.js';

const RUN = '7a91e5ac-961d-4537-9f79-901c50f214db';
const PROJECT = 'npdxmbxmnnzkdqlwtizu';
const DIRECTORY = resolve('artifacts/real-contract-deployment', RUN);

export async function claimManagedMutation(directory: string, key: string): Promise<boolean> {
  const prefix = `${RUN}:${PROJECT}:migration:`;
  if (!key.startsWith(prefix) || !/^[1-9][0-9]*:[a-f0-9]{64}$/.test(key.slice(prefix.length))) {
    throw new Error('MANAGED_CLAIM_SCOPE_REJECTED');
  }
  const hash = createHash('sha256').update(key).digest('hex');
  try {
    await writeDeploymentEvidence(directory, `claim-${hash}.json`, {
      key, claimedAt: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return false;
    throw error;
  }
}

async function main() {
  const proof = loadAllocationProof({ REAL_ACCEPTANCE_ALLOCATION_JOURNAL: DIRECTORY });
  const allocation = allocationProofDetails(proof);
  if (!proof || !allocation || allocation.runId !== RUN || allocation.projectRef !== PROJECT) {
    throw new Error('MANAGED_ALLOCATION_REJECTED');
  }
  const request = await managementTransport();
  const readback = await request(`/v1/projects/${PROJECT}`);
  if (readback.status !== 200) throw new Error('MANAGED_PROJECT_READ_FAILED');
  decodeSchema(Type.Object({
    id: Type.Literal('b48694d8-589e-46ea-885e-396d6b66fa5c'),
    ref: Type.Literal(PROJECT), name: Type.Literal(`supauth-contract-${RUN}`),
    created_at: Type.Literal('2026-09-09T06:33:53.457Z'),
    status: Type.Literal('ACTIVE_HEALTHY'),
    api: Type.Object({ url: Type.Literal(allocation.projectOrigin) }),
  }), readback.body);
  const installer = createRealContractInstaller({
    allocation: proof,
    transport: input => request(input.path, {
      method: input.method, ...(input.body === undefined ? {} : { body: input.body }),
    }),
    claimMutation: key => claimManagedMutation(DIRECTORY, key),
  });
  const migrations = await installer.migrations();
  const catalog = migrations.status === 'passed' ? await installer.catalog() : undefined;
  const result = {
    observedAt: new Date().toISOString(), projectRef: PROJECT, runId: RUN,
    transport: 'SupaCloud Management API', directDatabaseConnection: false,
    migrations, ...(catalog === undefined ? {} : { catalog }),
    backendAcceptancePassed: false, browserAcceptancePassed: false,
  };
  await writeDeploymentEvidence(DIRECTORY, `managed-database-${crypto.randomUUID()}.json`, result);
  console.log(JSON.stringify(result));
  if (migrations.status !== 'passed' || catalog?.status !== 'passed') process.exitCode = 1;
}

if (import.meta.main) {
  try { await main(); } catch (error) {
    const code = error instanceof Error && /^[A-Z_]+$/.test(error.message)
      ? error.message : 'MANAGED_DATABASE_EXECUTION_FAILED';
    console.error(JSON.stringify({ code, outcome: 'inspect-before-retry' }));
    process.exitCode = 1;
  }
}
