import { describe, it, expect } from 'bun:test';

describe('Roles repository — assignRole validation', () => {
  it('throws when neither userId nor applicationId is provided', async () => {
    const roles = await import('../repositories/roles.js');
    // assignRole validates input before DB access
    expect(roles.assignRole({ roleId: 'role-1' })).rejects.toThrow(
      'Either userId or applicationId is required for role assignment'
    );
  });

  it('throws with empty strings for userId and applicationId', async () => {
    const roles = await import('../repositories/roles.js');
    expect(roles.assignRole({ roleId: 'role-1', userId: '', applicationId: '' })).rejects.toThrow(
      'Either userId or applicationId is required for role assignment'
    );
  });
});

describe('Roles repository — module structure', () => {
  it('exports all expected functions', async () => {
    const roles = await import('../repositories/roles.js');
    const expectedFns = [
      'listRoles', 'getRole', 'createRole', 'updateRole', 'deleteRole',
      'createPermission', 'deletePermission', 'listRolePermissions',
      'assignRole', 'listRoleAssignments', 'revokeRole', 'getUserRoleAssignments',
      'getOrgRoleAssignments', 'resolveUserPermissions',
    ];
    for (const fn of expectedFns) {
      expect(typeof (roles as any)[fn]).toBe('function');
    }
  });
});
