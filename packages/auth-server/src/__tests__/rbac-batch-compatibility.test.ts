import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { ApiContractError } from '../utils/api-contract.js';
import { operationOutput } from '../utils/operation-contract.js';

const validUsers = [
  { id: 'user-one', app_metadata: { role: 'admin' } },
  { id: 'user-two', app_metadata: { role: 'admin' } },
  { id: 'user-three', app_metadata: { role: 'admin' } },
];
let users: unknown = validUsers;
let inventoryReads = 0;
const assignments = new Map<string, unknown>();
const assignmentReads: string[] = [];
const writes: unknown[] = [];
const audits: unknown[] = [];

mock.module('../supacloud/adapter.js', () => ({
  getSupaCloudAdapter: () => ({
    listUsers: async () => { inventoryReads++; return users; },
    listRoles: async () => [{ id: 'role-one', name: 'admin' }],
    getUserRoleAssignments: async (userId: string) => {
      assignmentReads.push(userId);
      return assignments.get(userId) ?? [];
    },
    assignRole: async (roleId: string, data: unknown) => {
      writes.push({ roleId, data });
      return {};
    },
  }),
}));
mock.module('../repositories/audit.js', () => ({
  logAudit: async (event: unknown) => { audits.push(event); },
}));
const { rbacBridgeRoutes } = await import('../routes/rbac-bridge.js');
const app = new Elysia().onError(({ error, set }) => {
  if (error instanceof ApiContractError) {
    set.status = error.status;
    return { code: error.code };
  }
  set.status = 500;
  return { code: 'unexpected_error' };
}).use(rbacBridgeRoutes);

beforeEach(() => {
  users = validUsers;
  inventoryReads = 0;
  assignments.clear();
  for (const list of [assignmentReads, writes, audits]) list.length = 0;
});

function request(batchSize: unknown, dryRun = false) {
  return app.handle(new Request(`http://localhost/v1/rbac-bridge/${dryRun ? 'dry-run' : 'import'}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mappings: [{ legacyRole: 'admin', supaoauthRole: 'admin' }],
      autoCreateRoles: false, preserveLegacyRole: true, batchSize,
    }),
  }));
}

const batchCases = [
  { batchSize: 0, total: 0, userIds: [] },
  { batchSize: -1, total: -1, userIds: [] },
  { batchSize: -0.5, total: -0.5, userIds: [] },
  { batchSize: 0.5, total: 0.5, userIds: ['user-one'] },
  { batchSize: 1.5, total: 1.5, userIds: ['user-one', 'user-two'] },
  { batchSize: 3, total: 3, userIds: ['user-one', 'user-two', 'user-three'] },
  { batchSize: 100, total: 3, userIds: ['user-one', 'user-two', 'user-three'] },
];

describe.each([false, true])('legacy numeric batch semantics dryRun=%s', (dryRun) => {
  test.each(batchCases)('retains HEAD selection and total for $batchSize', async ({ batchSize, total, userIds }) => {
    const response = await request(batchSize, dryRun);
    expect(response.status).toBe(200);
    const result = operationOutput('importRbacMigration', await response.json());
    expect(result).toMatchObject({ total, migrated: userIds.length, skipped: 0, errors: 0, dryRun });
    expect(result.details.map(item => item.userId)).toEqual(userIds);
    expect(assignmentReads).toEqual(userIds);
    expect(writes).toHaveLength(dryRun ? 0 : userIds.length);
    expect(audits).toHaveLength(1);
  });
});

describe('numeric compatibility retains preflight safety', () => {
  test('validates all inventory items even when the write batch is zero', async () => {
    users = [...validUsers, { id: 123 }];
    const response = await request(0);
    expect(response.status).toBe(502);
    expect(writes).toEqual([]);
    expect(audits).toEqual([]);
  });

  test('preflights the fractional last selected user before writing any earlier assignment', async () => {
    assignments.set('user-two', [{}]);
    const response = await request(1.5);
    expect(response.status).toBe(502);
    expect(assignmentReads).toEqual(['user-one', 'user-two']);
    expect(writes).toEqual([]);
    expect(audits).toEqual([]);
  });

  test.each(['0', null, false, {}, []].map(batchSize => ({ batchSize })))('rejects wrong-type batchSize $batchSize before inventory or writes', async ({ batchSize }) => {
    const response = await request(batchSize);
    expect(response.status).toBe(400);
    expect(inventoryReads).toBe(0);
    expect(writes).toEqual([]);
    expect(audits).toEqual([]);
  });

  test('rejects a JSON number overflowing to Infinity before inventory or writes', async () => {
    const response = await app.handle(new Request('http://localhost/v1/rbac-bridge/import', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: '{"batchSize":1e309}',
    }));
    expect(response.status).toBe(400);
    expect(inventoryReads).toBe(0);
    expect(writes).toEqual([]);
    expect(audits).toEqual([]);
  });
});
