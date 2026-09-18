import { describe, expect, it } from 'bun:test';
import {
  createPermissionCatalog,
  permissionCatalogDigest,
  resolveAuthorization,
  type AuthorizationRequest,
} from './index.js';

const request: AuthorizationRequest = {
  principal: { kind: 'user', issuer: 'https://issuer.test', subject: 'user-1' },
  applicationId: 'billing-api',
  domain: { type: 'tenant', id: 'tenant-1' },
};
const catalog = {
  applicationId: request.applicationId,
  version: '2026-09-18',
  permissions: ['invoice:write', 'invoice:read'],
};

describe('permission catalog integrity regressions', () => {
  it('binds the computed digest even when the caller omits it', async () => {
    const digest = await permissionCatalogDigest(catalog);
    const context = await resolveAuthorization(request, async () => ['invoice:read'], {
      permissionCatalog: catalog,
    });
    expect(context.permissionCatalogDigest).toBe(digest);
    expect(context.permissionCatalogVersion).toBe(catalog.version);
  });

  it('uses canonical ordering and includes application, version and permissions in the digest', async () => {
    const digest = await permissionCatalogDigest(catalog);
    expect(await permissionCatalogDigest({ ...catalog, permissions: [...catalog.permissions].reverse() })).toBe(digest);
    expect(await permissionCatalogDigest({ ...catalog, applicationId: 'other-api' })).not.toBe(digest);
    expect(await permissionCatalogDigest({ ...catalog, version: '2026-09-19' })).not.toBe(digest);
    expect(await permissionCatalogDigest({ ...catalog, permissions: ['invoice:read'] })).not.toBe(digest);
  });

  it('normalizes a valid uppercase digest to canonical lowercase', async () => {
    const digest = await permissionCatalogDigest(catalog);
    const context = await resolveAuthorization(request, async () => ['invoice:read'], {
      permissionCatalog: { ...catalog, digest: digest.toUpperCase() },
    });
    expect(context.permissionCatalogDigest).toBe(digest);
  });

  it('rejects a well-formed but incorrect digest before invoking the resolver', async () => {
    let calls = 0;
    await expect(resolveAuthorization(request, async () => {
      calls += 1;
      return ['invoice:read'];
    }, { permissionCatalog: { ...catalog, digest: '0'.repeat(64) } })).rejects.toMatchObject({
      status: 503, code: 'authorization_unavailable',
    });
    expect(calls).toBe(0);
  });

  it('rejects unbounded or noncanonical versions', () => {
    for (const version of ['', 'bad version', 'a'.repeat(65), '#version']) {
      expect(() => createPermissionCatalog({ ...catalog, version })).toThrow(TypeError);
    }
    expect(createPermissionCatalog({ ...catalog, version: 'a'.repeat(64) }).version).toHaveLength(64);
  });

  it('validates the application identifier even when constructing a standalone catalog', () => {
    for (const applicationId of ['', 'bad app', 'a'.repeat(513)]) {
      expect(() => createPermissionCatalog({ ...catalog, applicationId })).toThrow(TypeError);
    }
  });

  it('rejects sparse arrays rather than skipping missing permissions', () => {
    const permissions: string[] = ['invoice:read'];
    permissions.length = 2;
    expect(() => createPermissionCatalog({ ...catalog, permissions })).toThrow(TypeError);
  });

  it('snapshots the catalog before awaiting digest calculation or the resolver', async () => {
    const permissions = ['invoice:read'];
    const pending = resolveAuthorization(request, async () => ['invoice:write'], {
      permissionCatalog: { ...catalog, permissions },
    });
    permissions.push('invoice:write');
    await expect(pending).rejects.toMatchObject({ status: 503, code: 'authorization_unavailable' });
  });

  it('keeps legacy resolutions without a catalog unchanged', async () => {
    const context = await resolveAuthorization(request, async () => ['invoice:read']);
    expect(context.permissionCatalogVersion).toBeUndefined();
    expect(context.permissionCatalogDigest).toBeUndefined();
  });
});
