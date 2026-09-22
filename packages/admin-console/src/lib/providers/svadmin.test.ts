import { afterEach, describe, expect, mock, test } from 'bun:test';

type AccessControlProvider = {
  options?: unknown;
  can(input: { resource: string; action: string }): Promise<unknown>;
};

let registeredProvider: AccessControlProvider | undefined;

mock.module('@svadmin/core', () => ({
  createPermissionAccessControlProvider(snapshot: { permissions: readonly string[] }, options: unknown) {
    const permissions = new Set(snapshot.permissions);
    return {
      options,
      async can({ resource, action }: { resource: string; action: string }) {
        const permission = `${resource}:${action}`;
        return permissions.has(permission)
          ? { can: true }
          : { can: false, reason: `Missing permission: ${permission}` };
      },
    };
  },
  getAccessControlProvider() {
    return registeredProvider;
  },
  resetAccessControlProvider() {
    registeredProvider = undefined;
  },
  setAccessControlProvider(provider: AccessControlProvider) {
    registeredProvider = provider;
  },
}));

const { getAccessControlProvider, resetAccessControlProvider } = await import('@svadmin/core');
const {
  ADMIN_PERMISSION_APPLICATION_ID,
  ADMIN_PERMISSION_CATALOG_VERSION,
  createAdminPermissionSnapshot,
  registerAdminAccessControl,
} = await import('./svadmin-permissions');

afterEach(() => resetAccessControlProvider());

describe('SVAdmin integration', () => {
  test('projects dot-separated SupaOAuth grants into SVAdmin permissions', () => {
    expect(createAdminPermissionSnapshot({ permissions: ['audit.read', 'tenant.members.manage'] })).toEqual({
      applicationId: ADMIN_PERMISSION_APPLICATION_ID,
      catalogVersion: ADMIN_PERMISSION_CATALOG_VERSION,
      permissions: [
        'audit:list',
        'audit:show',
        'tenant.members:list',
        'tenant.members:show',
        'tenant.members:create',
        'tenant.members:edit',
        'tenant.members:delete',
      ],
    });
  });

  test('maps UI actions to the least-privilege SupaOAuth grants', async () => {
    await registerAdminAccessControl({ getPermissions: async () => ({ permissions: ['applications.manage'] }) });
    const provider = getAccessControlProvider();
    await expect(provider?.can({ resource: 'applications', action: 'list' })).resolves.toEqual({ can: true });
    await expect(provider?.can({ resource: 'applications', action: 'create' })).resolves.toEqual({ can: true });
    await expect(provider?.can({ resource: 'applications', action: 'delete' })).resolves.toEqual({ can: true });
    await expect(provider?.can({ resource: 'applications', action: 'export' })).resolves.toEqual({
      can: false,
      reason: 'Missing permission: applications:export',
    });
  });

  test('keeps sensitive fields and exports explicit', async () => {
    await registerAdminAccessControl({
      getPermissions: async () => ({ permissions: ['audit.read', 'audit.read_sensitive', 'audit.export'] }),
    });
    const provider = getAccessControlProvider();
    await expect(provider?.can({ resource: 'audit', action: 'show' })).resolves.toEqual({ can: true });
    await expect(provider?.can({ resource: 'audit', action: 'field' })).resolves.toEqual({ can: true });
    await expect(provider?.can({ resource: 'audit', action: 'export' })).resolves.toEqual({ can: true });
  });

  test('expands the backend wildcard into the known admin catalog', () => {
    const snapshot = createAdminPermissionSnapshot({ permissions: ['*'] });
    expect(snapshot.permissions).toContain('users:list');
    expect(snapshot.permissions).toContain('audit:export');
    expect(snapshot.permissions).not.toContain('*');
  });

  test('registers the permission projection without replacing backend authorization', async () => {
    await registerAdminAccessControl({ getPermissions: async () => ({ permissions: ['audit.read'] }) });
    const provider = getAccessControlProvider();
    expect(provider?.options?.buttons).toEqual({ enableAccessControl: true, hideIfUnauthorized: false });
    await expect(provider?.can({ resource: 'audit', action: 'show' })).resolves.toEqual({ can: true });
    await expect(provider?.can({ resource: 'users', action: 'list' })).resolves.toEqual({ can: false, reason: 'Missing permission: users:list' });
  });
});
