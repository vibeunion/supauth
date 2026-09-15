import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { ApiContractError } from '../utils/api-contract.js';

const validUser = { id: 'user-one', app_metadata: { role: 'admin' } };
const validRole = { id: 'role-one', name: 'admin' };
let users: unknown;
let roles: unknown;
let rejectAssignment: boolean;
const assignments = new Map<string, unknown>();
const assignmentReads: string[] = [];
const mutations: Array<{ kind: 'create' | 'assign'; data: unknown }> = [];
const createdRoles: Array<{ id: string; name: string }> = [];
const audits: unknown[] = [];

mock.module('../supacloud/adapter.js', () => ({
  getSupaCloudAdapter: () => ({
    listUsers: async () => users,
    listRoles: async () => Array.isArray(roles) ? [...roles, ...createdRoles] : roles,
    getUserRoleAssignments: async (userId: string) => {
      assignmentReads.push(userId);
      return assignments.has(userId) ? assignments.get(userId) : [];
    },
    createRole: async (data: { name: string }) => {
      mutations.push({ kind: 'create', data });
      const created = { id: `created-${data.name}`, name: data.name };
      createdRoles.push(created);
      return created;
    },
    assignRole: async (roleId: string, data: Record<string, unknown>) => {
      mutations.push({ kind: 'assign', data: { roleId, ...data } });
      if (rejectAssignment) throw new Error('Assignment outcome is unknown');
      return {};
    },
  }),
}));
mock.module('../repositories/audit.js', () => ({
  logAudit: async (event: unknown) => { audits.push(event); },
}));

const { rbacBridgeRoutes } = await import('../routes/rbac-bridge.js');
const app = new Elysia()
  .onError(({ error, set }) => {
    if (error instanceof ApiContractError) {
      set.status = error.status;
      return { code: error.code };
    }
    set.status = 500;
    return { code: 'unexpected_error' };
  })
  .use(rbacBridgeRoutes);

beforeEach(() => {
  users = [validUser];
  roles = [validRole];
  rejectAssignment = false;
  assignments.clear();
  for (const events of [assignmentReads, mutations, createdRoles, audits]) events.length = 0;
});

function request(body: Record<string, unknown> = {}, route = 'import') {
  return app.handle(new Request(`http://localhost/v1/rbac-bridge/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mappings: [{ legacyRole: 'admin', supaoauthRole: 'admin' }],
      autoCreateRoles: false,
      ...body,
    }),
  }));
}

async function expectInvalidInventory(body: Record<string, unknown> = {}) {
  const response = await request(body);
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ code: 'invalid_upstream_response' });
  expect(mutations).toHaveLength(0);
  expect(audits).toHaveLength(0);
}

const invalidUsers: Array<{ name: string; value: unknown }> = [
  { name: 'numeric id', value: [{ ...validUser, id: 123 }] },
  { name: 'missing id', value: [{ app_metadata: validUser.app_metadata }] },
  { name: 'empty id', value: [{ ...validUser, id: '' }] },
  { name: 'primitive item', value: [1] },
  { name: 'null item', value: [null] },
  { name: 'sparse list', value: Array(1) },
  { name: 'numeric metadata', value: [{ ...validUser, app_metadata: 0 }] },
  { name: 'array metadata', value: [{ ...validUser, app_metadata: [] }] },
  { name: 'numeric legacy role', value: [{ ...validUser, app_metadata: { role: 123 } }] },
  { name: 'object legacy role', value: [{ ...validUser, app_metadata: { role: {} } }] },
  { name: 'invalid users envelope', value: { users: 'invalid' } },
  { name: 'missing envelope', value: {} },
  { name: 'null response', value: null },
];

describe.each([false, true])('RBAC inventory preflight autoCreateRoles=%s', (autoCreateRoles) => {
  test.each(invalidUsers)('rejects $name before writes or audit', async ({ value }) => {
    users = value;
    if (autoCreateRoles) roles = [];
    await expectInvalidInventory({ autoCreateRoles });
  });

  test.each([
    { name: 'bad role envelope', value: { roles: 'invalid-list' } },
    { name: 'unknown envelope', value: { unexpected: [] } },
    { name: 'missing role id', value: [{ name: 'admin' }] },
    { name: 'numeric role id', value: [{ ...validRole, id: 123 }] },
    { name: 'numeric role name', value: [{ ...validRole, name: 123 }] },
    { name: 'missing role name', value: [{ id: 'role-one' }] },
    { name: 'invalid later role', value: [validRole, { id: 'role-two' }] },
  ])('rejects $name before writes or audit', async ({ value }) => {
    roles = value;
    await expectInvalidInventory({ autoCreateRoles });
  });

  test.each([
    { name: 'bad assignment envelope', value: { assignments: 'invalid' } },
    { name: 'missing assignment role id', value: [{}] },
    { name: 'numeric assignment role id', value: [{ roleId: 123 }] },
    { name: 'numeric organization id', value: [{ roleId: 'role-other', organizationId: 123 }] },
    { name: 'null assignment', value: [null] },
    { name: 'sparse assignment list', value: Array(1) },
  ])('rejects $name for a later user before any earlier write', async ({ value }) => {
    users = [validUser, { ...validUser, id: 'user-two' }];
    assignments.set('user-two', value);
    if (autoCreateRoles) roles = [];
    await expectInvalidInventory({ autoCreateRoles });
    expect(assignmentReads).toEqual(['user-one', 'user-two']);
  });
});

describe('RBAC compatibility and batch safety', () => {
  test('validates all returned user items, including beyond the write batch', async () => {
    users = [validUser, { ...validUser, id: 123 }];
    await expectInvalidInventory({ batchSize: 1 });
  });

  test('does not invoke getters in an upstream envelope', async () => {
    let getterCalls = 0;
    users = Object.defineProperty({}, 'users', {
      enumerable: true,
      get() { getterCalls++; return [validUser]; },
    });
    await expectInvalidInventory();
    expect(getterCalls).toBe(0);
  });

  test.each(['items', 'users', 'roles', 'assignments'])('preserves supported %s envelopes and aliases', async (field) => {
    users = { [field]: [validUser] };
    roles = { [field]: [{ role_id: validRole.id, role_name: validRole.name }] };
    assignments.set(validUser.id, { [field]: [{ role_id: validRole.id, organization_id: null }] });
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ migrated: 0, skipped: 1, errors: 0 });
    expect(mutations).toHaveLength(0);
    expect(audits).toHaveLength(1);
  });

  test('retains nullable or absent legacy metadata as an unmapped user', async () => {
    users = [
      { id: 'user-one' },
      { id: 'user-two', app_metadata: null },
      { id: 'user-three', app_metadata: { role: null, other: { json: [1, true] } } },
    ];
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 3, migrated: 0, skipped: 3, errors: 0 });
    expect(mutations).toHaveLength(0);
    expect(assignmentReads).toHaveLength(0);
  });

  test('preserves global assignment checks when organization fields are nullable', async () => {
    assignments.set(validUser.id, [{ roleId: validRole.id, organizationId: null }]);
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ migrated: 0, skipped: 1 });
    expect(mutations).toHaveLength(0);
  });

  test('does not mistake an organization assignment for the global role', async () => {
    assignments.set(validUser.id, [{ role_id: validRole.id, organization_id: 'org-one' }]);
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ migrated: 1, skipped: 0 });
    expect(mutations).toEqual([{
      kind: 'assign',
      data: { roleId: validRole.id, userId: validUser.id, organizationId: null, applicationId: null },
    }]);
  });

  test('creates missing roles and then imports only after valid preflight', async () => {
    roles = [];
    const response = await request({ autoCreateRoles: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 1, migrated: 1, errors: 0 });
    expect(mutations.map(event => event.kind)).toEqual(['create', 'assign']);
    expect(audits).toHaveLength(1);
  });

  test('dry-run preserves the preview and never writes roles or assignments', async () => {
    const response = await request({ autoCreateRoles: true }, 'dry-run');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ dryRun: true, migrated: 1, errors: 0 });
    expect(mutations).toHaveLength(0);
    expect(audits).toHaveLength(1);
  });

  test('does not assign twice when the user list contains a repeated user', async () => {
    users = [validUser, validUser];
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 2, migrated: 1, skipped: 1, errors: 0 });
    expect(mutations).toHaveLength(1);
    expect(assignmentReads).toEqual([validUser.id]);
  });

  test('does not retry an uncertain assignment for a repeated user', async () => {
    users = [validUser, validUser];
    rejectAssignment = true;
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ migrated: 0, errors: 2 });
    expect(mutations).toHaveLength(1);
  });
});
