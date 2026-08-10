import { beforeAll, describe, expect, mock, test } from 'bun:test';

const recordStep = mock(async () => {
  throw new Error('relation supaoauth.provisioning_records does not exist');
});
const runDatabaseMigration = mock(async () => {
  throw new Error('Failed query: INSERT INTO secret_table VALUES (credential)');
});

mock.module('../repositories/provisioning.js', () => ({
  recordStep,
  isProjectFullyProvisioned: mock(async () => {
    throw new Error('provisioning state unavailable');
  }),
  getProjectProvisioning: mock(async () => []),
  resetProjectProvisioning: mock(async () => undefined),
}));

mock.module('../repositories/audit.js', () => ({
  logAudit: mock(async () => {
    throw new Error('audit table unavailable');
  }),
}));

mock.module('../supacloud/adapter.js', () => ({
  isSupaCloudApiError: () => false,
  getSupaCloudAdapterForProject: () => ({
    getProjectRef: () => 'lhevaxecbonjjdbardgi',
    getTargetInfo: () => ({ runtimeProjectScoped: true, storageProjectScoped: true }),
    runDatabaseMigration,
    getAuthConfig: mock(async () => undefined),
    verifyGatewayRoutes: mock(async () => ({ ok: true, probes: [] })),
    createStorageBucket: mock(async () => undefined),
  }),
}));

let provisioningRoutes: typeof import('../routes/provisioning.js').provisioningRoutes;

beforeAll(async () => {
  ({ provisioningRoutes } = await import('../routes/provisioning.js'));
});

describe('provisioning reconcile failure contract', () => {
  test('returns structured failures when migration and state persistence both fail', async () => {
    const response = await provisioningRoutes.handle(new Request(
      'http://localhost/v1/provisioning/lhevaxecbonjjdbardgi/reconcile',
      { method: 'POST' },
    ));
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      results: Array<{ step: string; status: string; details?: Record<string, unknown> }>;
      fully_provisioned: boolean;
    };
    const migration = payload.results.find(result => result.step === 'db_migration');
    expect(migration).toMatchObject({
      status: 'failed',
      details: {
        error_code: 'provisioning_step_failed',
        state_persistence: 'unavailable',
      },
    });
    expect(migration?.details?.migration).toBeString();
    expect(JSON.stringify(payload)).not.toContain('secret_table');
    expect(JSON.stringify(payload)).not.toContain('credential');
    expect(payload.results).toHaveLength(4);
    expect(payload.results.every(result => result.status === 'failed')).toBe(true);
    expect(payload.fully_provisioned).toBe(false);
  });
});
