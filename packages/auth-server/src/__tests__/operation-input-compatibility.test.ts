import { afterEach, beforeEach, describe, expect, it, mock, setSystemTime } from 'bun:test';
import { Elysia } from 'elysia';
import type { OperationResult, RbacMigrationPolicy } from '../../../shared/src/server-operations.js';
import { ApiContractError } from '../utils/api-contract.js';
import { operationInput, operationOutput } from '../utils/operation-contract.js';

const calls: Array<{ operation: string; input: unknown }> = [];
let versionEntries: OperationResult<'createApiVersion'>[] = [];
const defaultPolicy: RbacMigrationPolicy = {
  mappings: [], dryRun: true, autoCreateRoles: true, preserveLegacyRole: true, batchSize: 100,
};
const exportResult = {
  id: 'export-one', project_ref: 'project-one', actor: 'admin', format: 'jsonl', status: 'pending',
  row_count: 0, checksum: null, checkpoint_hash: null, expires_at: '2026-09-10', created_at: '2026-09-09',
  completed_at: null, filters: {
    eventType: null, resourceType: null, resourceId: null, actorId: null,
    status: null, method: null, from: null, to: null,
  },
} satisfies OperationResult<'createAuditExport'>;

mock.module('../repositories/rbac-bridge.js', () => ({
  buildDefaultPolicy: () => ({ ...defaultPolicy }),
  ensureRolesExist: async (policy: RbacMigrationPolicy) => {
    calls.push({ operation: 'ensureRolesExist', input: policy });
    return [];
  },
  importLegacyRoles: async (policy: RbacMigrationPolicy): Promise<OperationResult<'importRbacMigration'>> => {
    calls.push({ operation: 'importLegacyRoles', input: policy });
    return { total: 0, migrated: 0, skipped: 0, errors: 0, details: [], dryRun: policy.dryRun };
  },
  generateCompatibilityHelper: (ref: string) => `sql:${ref}`,
}));
mock.module('../supacloud/adapter.js', () => ({
  getSupaCloudAdapter: () => ({
    exportAuditLogs: async (input: unknown) => {
      calls.push({ operation: 'exportAuditLogs', input });
      return exportResult;
    },
  }),
}));
mock.module('../repositories/api-versions.js', () => ({
  recordVersionChange: async (input: Omit<OperationResult<'createApiVersion'>, 'id' | 'createdAt'>) => {
    calls.push({ operation: 'recordVersionChange', input });
    return { id: 'version-one', createdAt: '2026-09-09', ...input };
  },
  listVersions: async () => versionEntries,
  getVersionChanges: async () => versionEntries,
}));

const { adminToolRoutes } = await import('../routes/admin-tools.js');
const { rbacBridgeRoutes } = await import('../routes/rbac-bridge.js');
const { auditRoutes } = await import('../routes/audit.js');
const { apiVersionRoutes } = await import('../routes/api-versions.js');
const app = new Elysia()
  .onError(({ error, set }) => {
    if (error instanceof ApiContractError) {
      set.status = error.status;
      return { code: error.code };
    }
    set.status = 500;
    return { code: 'unexpected_error' };
  })
  .use(adminToolRoutes).use(rbacBridgeRoutes).use(auditRoutes).use(apiVersionRoutes);

function post(path: string, body?: unknown) {
  return app.handle(new Request(`http://localhost${path}`, {
    method: 'POST',
    ...(body === undefined ? {} : {
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }),
  }));
}

beforeEach(() => {
  calls.length = 0;
  versionEntries = [];
  setSystemTime(new Date('2026-09-09T00:00:00.000Z'));
});
afterEach(() => { setSystemTime(); });

describe('operation legacy input defaults', () => {
  it('compiles the same empty plan with an omitted body or an empty object', async () => {
    const omitted = await post('/v1/admin-tools/authorization-compiler');
    const empty = await post('/v1/admin-tools/authorization-compiler', {});
    expect(omitted.status).toBe(200);
    expect(empty.status).toBe(200);
    const omittedPlan = operationOutput('compileAuthorizationPlan', await omitted.json());
    const emptyPlan = operationOutput('compileAuthorizationPlan', await empty.json());
    expect(Number.isFinite(Date.parse(omittedPlan.generated_at))).toBe(true);
    expect(Number.isFinite(Date.parse(emptyPlan.generated_at))).toBe(true);
    expect({ ...omittedPlan, generated_at: emptyPlan.generated_at }).toEqual(emptyPlan);
    expect(calls).toEqual([]);
  });

  it('preserves null/omitted/empty RBAC defaults without replaying import', async () => {
    for (const dryRun of [true, false]) {
      for (const body of [undefined, null, {}]) {
        calls.length = 0;
        const response = await post(`/v1/rbac-bridge/${dryRun ? 'dry-run' : 'import'}`, body);
        expect(response.status).toBe(200);
        const policy = { ...defaultPolicy, dryRun };
        expect(calls).toEqual([
          ...(dryRun ? [] : [{ operation: 'ensureRolesExist', input: policy }]),
          { operation: 'importLegacyRoles', input: policy },
        ]);
      }
    }
  });

  it('passes every finite legacy batch size unchanged to the migration implementation', async () => {
    for (const batchSize of [0, -1, -0.5, 0.5, 1.5, 100, Number.MAX_VALUE]) {
      for (const dryRun of [true, false]) {
        calls.length = 0;
        const response = await post(`/v1/rbac-bridge/${dryRun ? 'dry-run' : 'import'}`, { batchSize });
        expect(response.status).toBe(200);
        const policy = { ...defaultPolicy, batchSize, dryRun };
        expect(calls).toEqual([
          ...(dryRun ? [] : [{ operation: 'ensureRolesExist', input: policy }]),
          { operation: 'importLegacyRoles', input: policy },
        ]);
      }
    }
  });

  it('rejects non-finite or undefined numeric properties rather than replacing them with defaults', () => {
    for (const batchSize of [NaN, Infinity, -Infinity, undefined]) {
      expect(() => operationInput('importRbacMigration', { body: { batchSize } })).toThrow(ApiContractError);
    }
    expect(calls).toEqual([]);
  });

  it('preserves null collection defaults without accepting malformed collection items', async () => {
    const empty = await post('/v1/admin-tools/authorization-compiler', {});
    const emptyPlan = operationOutput('compileAuthorizationPlan', await empty.json());
    for (const key of ['tables', 'storage_buckets', 'realtime_channels', 'edge_functions']) {
      const response = await post('/v1/admin-tools/authorization-compiler', { [key]: null });
      expect(response.status).toBe(200);
      const plan = operationOutput('compileAuthorizationPlan', await response.json());
      expect(Number.isFinite(Date.parse(plan.generated_at))).toBe(true);
      expect({ ...plan, generated_at: emptyPlan.generated_at }).toEqual(emptyPlan);
      expect((await post('/v1/admin-tools/authorization-compiler', { [key]: [1] })).status).toBe(400);
    }
    const nullPolicies = await post('/v1/admin-tools/rls-migration', { policies: null });
    const emptyPolicies = await post('/v1/admin-tools/rls-migration', {});
    expect(nullPolicies.status).toBe(200);
    expect(emptyPolicies.status).toBe(200);
    expect(await nullPolicies.json()).toEqual(await emptyPolicies.json());
    expect(calls).toEqual([]);
  });

  it('normalizes null audit export to the same empty filters exactly once', async () => {
    for (const body of [undefined, null, {}]) {
      calls.length = 0;
      const response = await post('/v1/audit/export', body);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(exportResult);
      expect(calls).toEqual([{ operation: 'exportAuditLogs', input: {} }]);
    }
  });

  it('keeps diagnostic warnings for incomplete targets and still compiles valid siblings', async () => {
    const response = await post('/v1/admin-tools/authorization-compiler', {
      tables: [{}, { table: 'projects', owner_column: 'owner_id', operations: ['read'] }],
      storage_buckets: [{}],
      realtime_channels: [{ topic: 'missing-permission' }],
      edge_functions: [{ permission: 'missing-name' }],
    });
    expect(response.status).toBe(200);
    const plan = operationOutput('compileAuthorizationPlan', await response.json());
    expect(plan.warnings).toEqual([
      'Skipped a table target without table name.',
      'Skipped a storage bucket target without bucket_id.',
      'Skipped a realtime target without topic or permission.',
      'Skipped an edge function target without name or permission.',
    ]);
    expect(plan.permissions).toEqual(['project.read']);
    expect(plan.sql.tables).toContain('ON "public"."projects"');
    expect(plan.sql.storage).toBe('');
    expect(plan.sql.realtime).toBe('');
    expect(plan.edge_functions).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('preserves the nullable version description accepted by the repository', async () => {
    const response = await post('/v1/api-versions', {
      version: '1.0', change_type: 'added', path: '/resource', method: 'GET', description: null,
    });
    expect(response.status).toBe(200);
    expect(calls).toEqual([{ operation: 'recordVersionChange', input: {
      version: '1.0', changeType: 'added', path: '/resource', method: 'GET', description: null,
    } }]);
  });

  it('preserves empty version/path/method and custom change types in write and read wire results', async () => {
    for (const changeType of ['', 'custom.change']) {
      calls.length = 0;
      const response = await post('/v1/api-versions', {
        version: '', change_type: changeType, path: '', method: '',
      });
      const entry = {
        id: 'version-one', createdAt: '2026-09-09',
        version: '', changeType, path: '', method: '', description: null,
      };
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(entry);
      expect(calls).toEqual([{ operation: 'recordVersionChange', input: {
        version: '', changeType, path: '', method: '', description: null,
      } }]);
      versionEntries = [entry];
      const list = await app.handle(new Request('http://localhost/v1/api-versions'));
      expect(list.status).toBe(200);
      expect(await list.json()).toEqual({ items: [entry], total: 1 });
      const detail = await app.handle(new Request('http://localhost/v1/api-versions/fixture'));
      expect(detail.status).toBe(200);
      expect(await detail.json()).toEqual({ version: 'fixture', items: [entry], total: 1 });
    }
  });

  it('does not treat a non-string change type as a valid write or list receipt', () => {
    const entry = {
      id: 'version-one', createdAt: '2026-09-09', version: '',
      changeType: 7, path: '', method: '', description: null,
    };
    expect(() => operationOutput('createApiVersion', entry)).toThrow(ApiContractError);
    expect(() => operationOutput('listApiVersions', { items: [entry], total: 1 })).toThrow(ApiContractError);
    expect(() => operationOutput('getApiVersion', { version: '', items: [entry], total: 1 })).toThrow(ApiContractError);
    expect(calls).toEqual([]);
  });

  it('still rejects malformed bodies and fields before invoking dependencies', async () => {
    for (const [path, body] of [
      ['/v1/admin-tools/authorization-compiler', 1],
      ['/v1/rbac-bridge/import', []],
      ['/v1/rbac-bridge/import', { batchSize: '0' }],
      ['/v1/rbac-bridge/import', { batchSize: null }],
      ['/v1/rbac-bridge/import', { batchSize: false }],
      ['/v1/rbac-bridge/import', { batchSize: {} }],
      ['/v1/audit/export', false],
      ['/v1/api-versions', { version: '1.0', change_type: 'added', path: '/r', method: 'GET', description: 7 }],
      ['/v1/api-versions', { version: 0, change_type: 'custom', path: '', method: '' }],
      ['/v1/api-versions', { version: '', change_type: 0, path: '', method: '' }],
      ['/v1/api-versions', { version: '', change_type: '', path: null, method: '' }],
      ['/v1/api-versions', { version: '', change_type: '', path: '', method: false }],
    ] as const) {
      calls.length = 0;
      expect((await post(path, body)).status).toBe(400);
      expect(calls).toEqual([]);
    }
  });
});
