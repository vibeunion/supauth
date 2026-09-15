import { beforeEach, describe, expect, mock, test } from 'bun:test';

const template = {
  id: 'template-one', name: 'Fixture', templateRoles: [{ name: 'reader', permissions: ['read'] }],
  templateScopes: [], isDefault: false,
};
const orgFixture = {
  id: 'org-one', name: 'Fixture', description: '', members: [],
  created_at: '2026-09-08T00:00:00Z', updated_at: '2026-09-08T00:00:00Z',
};
let organizationReceipt: unknown = orgFixture;
let roleReceipt: unknown = { id: 'role-one' };
let permissionReceipt: unknown = { id: 'permission-one' };
let failAssignment = false;
const effects: Array<{ method: string; id?: string; roleId?: string; data?: unknown }> = [];
const adapter = {
  createOrganization: async () => { effects.push({ method: 'createOrganization' }); return organizationReceipt; },
  addOrganizationMember: async (id: string, data: unknown) => { effects.push({ method: 'addOrganizationMember', id, data }); },
  createRole: async (data: unknown) => { effects.push({ method: 'createRole', data }); return roleReceipt; },
  createPermission: async (roleId: string, data: unknown) => { effects.push({ method: 'createPermission', roleId, data }); return permissionReceipt; },
  assignRole: async (id: string, data: unknown) => {
    effects.push({ method: 'assignRole', id, data });
    if (failAssignment) throw new Error('fixture-assignment-failure');
  },
  deletePermission: async (roleId: string, id: string) => { effects.push({ method: 'deletePermission', roleId, id }); },
  deleteRole: async (id: string) => { effects.push({ method: 'deleteRole', id }); },
  deleteOrganization: async (id: string) => { effects.push({ method: 'deleteOrganization', id }); },
};
mock.module('../db/index.js', () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [template] }) }) }) }),
}));
mock.module('../supacloud/adapter.js', () => ({ getSupaCloudAdapter: () => adapter }));
const { instantiateFromTemplate } = await import('../repositories/organization-templates.js');
const instantiate = () => instantiateFromTemplate(template.id, { name: 'Fixture', creatorUserId: 'user-one' });

beforeEach(() => {
  organizationReceipt = orgFixture;
  roleReceipt = { id: 'role-one' };
  permissionReceipt = { id: 'permission-one' };
  failAssignment = false;
  effects.length = 0;
});

describe('organization template creation receipts', () => {
  test.each([123, ' ', {}, null].map(id => ({ id })))(
    'unconfirmed organization identity cannot become a write or deletion target: %j', async ({ id }) => {
      organizationReceipt = { ...orgFixture, id };
      await expect(instantiate()).rejects.toMatchObject({
        status: 502, code: 'organization_template_compensation_incomplete',
        message: 'Organization template creation returned an invalid receipt; the remote outcome requires recovery',
        details: { remote_resource_id_unknown: 'organization', recovery_required: true },
      });
      expect(effects).toEqual([{ method: 'createOrganization' }]);
    },
  );

  test.each([456, '', [], undefined].map(id => ({ id })))(
    'unconfirmed role identity permits only the confirmed organization rollback: %j', async ({ id }) => {
      roleReceipt = { id };
      await expect(instantiate()).rejects.toMatchObject({
        details: { remote_resource_id_unknown: 'role', recovery_required: true },
      });
      expect(effects.map(effect => effect.method)).toEqual([
        'createOrganization', 'addOrganizationMember', 'createRole', 'deleteOrganization',
      ]);
      expect(effects.at(-1)).toEqual({ method: 'deleteOrganization', id: 'org-one' });
    },
  );

  test.each([789, '', false, null].map(id => ({ id })))(
    'unconfirmed permission identity is never recorded as a compensation target: %j', async ({ id }) => {
      permissionReceipt = { id };
      await expect(instantiate()).rejects.toMatchObject({
        details: { remote_resource_id_unknown: 'permission', recovery_required: true },
      });
      expect(effects.map(effect => effect.method)).toEqual([
        'createOrganization', 'addOrganizationMember', 'createRole', 'createPermission',
        'deleteRole', 'deleteOrganization',
      ]);
      expect(effects.slice(-2)).toEqual([
        { method: 'deleteRole', id: 'role-one' }, { method: 'deleteOrganization', id: 'org-one' },
      ]);
    },
  );

  test('preserves successful canonical receipts and assignment targets', async () => {
    expect(await instantiate()).toMatchObject({ org: { id: 'org-one' }, rolesCreated: 1 });
    expect(effects.at(-1)).toEqual({
      method: 'assignRole', id: 'role-one', data: { user_id: 'user-one', organization_id: 'org-one' },
    });
  });

  test('preserves supported legacy aliases without converting their values', async () => {
    organizationReceipt = { organization_id: 'org-legacy', name: 'Fixture' };
    roleReceipt = { role_id: 'role-legacy' };
    permissionReceipt = { permission_id: 'permission-legacy' };
    expect(await instantiate()).toMatchObject({ org: { id: 'org-legacy' }, rolesCreated: 1 });
    expect(effects.at(-1)).toEqual({
      method: 'assignRole', id: 'role-legacy', data: { user_id: 'user-one', organization_id: 'org-legacy' },
    });
  });

  test('keeps confirmed permission/role/organization rollback order on later failures', async () => {
    failAssignment = true;
    await expect(instantiate()).rejects.toThrow('fixture-assignment-failure');
    expect(effects.slice(-3)).toEqual([
      { method: 'deletePermission', roleId: 'role-one', id: 'permission-one' },
      { method: 'deleteRole', id: 'role-one' },
      { method: 'deleteOrganization', id: 'org-one' },
    ]);
  });
});
