import { describe, expect, it } from 'bun:test';
import { readAuthorizationRequest, readResolvedPermissions } from './validation.js';
import {
  assertCan,
  AuthorizationForbiddenError,
  AuthorizationUnavailableError,
  can,
  canAll,
  canAny,
  decide,
  permission,
  resolveAuthorization,
  createPermissionCatalog,
  permissionCatalogDigest,
  type AuthorizationRequest,
} from './index.js';

const request: AuthorizationRequest = {
  principal: { kind: 'user', issuer: 'https://auth.example.test', subject: 'user-1' },
  applicationId: 'billing-api',
  domain: { type: 'organization', id: 'org-1' },
};

describe('@supauth/authorization-core', () => {
  it('normalizes a catalog and derives a stable digest for runtime binding', async () => {
    const catalog = createPermissionCatalog({
      applicationId: 'billing-api', version: '2026-09-18', permissions: ['invoice:write', 'invoice:read'],
    });
    expect(catalog.permissions).toEqual(['invoice:read', 'invoice:write']);
    await expect(permissionCatalogDigest(catalog)).resolves.toMatch(/^[a-f0-9]{64}$/);
    expect(() => createPermissionCatalog({
      applicationId: 'billing-api', version: '2026-09-18', digest: 'bad', permissions: ['invoice:read'],
    })).toThrow();
  });
  it('resolves exactly once and decides only from current effective grants', async () => {
    let calls = 0;
    const context = await resolveAuthorization(request, async receivedRequest => {
      calls += 1;
      expect(receivedRequest).toEqual({
        principal: { kind: 'user', issuer: 'https://auth.example.test', subject: 'user-1' },
        applicationId: 'billing-api',
        domain: { type: 'organization', id: 'org-1' },
      });
      expect(Object.isFrozen(receivedRequest)).toBe(true);
      expect(Object.isFrozen(receivedRequest.principal)).toBe(true);
      expect(Object.isFrozen(receivedRequest.domain)).toBe(true);
      // @ts-expect-error The runtime guard backs the public readonly contract.
      expect(() => { receivedRequest.applicationId = 'reporting-api'; }).toThrow();
      return ['invoice:read', 'invoice:update'];
    });

    expect(calls).toBe(1);
    expect(decide(context, permission('invoice:read'))).toMatchObject({ allowed: true, reason: 'granted' });
    expect(can(context, permission('invoice:delete'))).toBe(false);
    expect(canAny(context, [permission('invoice:delete'), permission('invoice:update')])).toBe(true);
    expect(canAll(context, [permission('invoice:read'), permission('invoice:update')])).toBe(true);
    expect(canAll(context, [])).toBe(false);
  });

  it('denies when the current effective grant set is empty', async () => {
    const context = await resolveAuthorization(request, async () => []);
    expect(decide(context, permission('invoice:read'))).toEqual({
      allowed: false,
      reason: 'missing_permission',
      permission: permission('invoice:read'),
    });
    expect(() => assertCan(context, permission('invoice:read'))).toThrow(AuthorizationForbiddenError);
  });

  it('keeps resolver failures in the 503 error class', async () => {
    await expect(resolveAuthorization(request, async () => {
      throw new Error('database offline');
    })).rejects.toMatchObject({ status: 503, code: 'authorization_unavailable' });
  });

  it('maps malformed resolutions to 503 and freezes effective permissions', async () => {
    await expect(resolveAuthorization(request, async () => ['invoice:*']))
      .rejects.toMatchObject({ status: 503, code: 'authorization_unavailable' });
    expect(() => readResolvedPermissions([42])).toThrow(TypeError);
    expect(() => readResolvedPermissions(null)).toThrow(TypeError);

    const context = await resolveAuthorization(request, async () => ['invoice:read', 'invoice:read']);
    expect(context.permissions).toEqual([permission('invoice:read')]);
    expect(Object.isFrozen(context.permissions)).toBe(true);
    expect(() => Object.defineProperty(context.permissions, '0', { value: 'invoice:delete' })).toThrow();
  });

  it('rejects wrong primitive types and missing request fields before resolution', () => {
    for (const value of [null, [], {}, { ...request, principal: null },
      { ...request, principal: { ...request.principal, issuer: 42 } },
      { ...request, principal: { ...request.principal, subject: undefined } },
      { ...request, applicationId: true },
      { ...request, domain: { type: 'organization', id: 42 } }]) {
      expect(() => readAuthorizationRequest(value)).toThrow(TypeError);
    }
    expect(readAuthorizationRequest(request)).toEqual(request);
  });
  it('accepts only canonical resource:action permissions', () => {
    expect(String(permission('invoice:read'))).toBe('invoice:read');
    for (const invalid of ['invoice.read', 'invoice:*', '*:read', 'invoice:read:own', 'Invoice:read']) {
      expect(() => permission(invalid)).toThrow(TypeError);
    }
  });

  it('binds resolved grants to an application-owned permission catalog when supplied', async () => {
    const catalog = {
      applicationId: request.applicationId,
      version: '2026-09-18',
      permissions: ['invoice:read', 'invoice:update'],
    } as const;
    const context = await resolveAuthorization(request, async () => ['invoice:read'], {
      permissionCatalog: catalog,
    });
    expect(context.permissions).toEqual([permission('invoice:read')]);
    expect(context.permissionCatalogVersion).toBe('2026-09-18');
    await expect(resolveAuthorization(request, async () => ['invoice:delete'], {
      permissionCatalog: catalog,
    })).rejects.toMatchObject({ status: 503, code: 'authorization_unavailable' });
    await expect(resolveAuthorization(request, async () => [], {
      permissionCatalog: { ...catalog, permissions: ['invoice:read', 'invoice:read'] },
    })).rejects.toThrow(TypeError);
    await expect(resolveAuthorization(request, async () => [], {
      permissionCatalog: { ...catalog, applicationId: 'other-api' },
    })).rejects.toThrow(TypeError);
  });
});
