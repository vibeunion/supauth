import { describe, expect, it } from 'bun:test';
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
  type AuthorizationRequest,
  type AuthorizationSnapshot,
} from './index.js';

const request: AuthorizationRequest = {
  principal: { kind: 'user', issuer: 'https://auth.example.test', subject: 'user-1' },
  applicationId: 'billing-api',
  domain: { type: 'organization', id: 'org-1' },
};

const resolvedAt = Date.now();

function snapshot(overrides: Partial<AuthorizationSnapshot> = {}): AuthorizationSnapshot {
  return {
    ...request,
    permissions: ['invoice:read', 'invoice:update'],
    membershipState: 'active',
    resolvedAt,
    expiresAt: resolvedAt + 60_000,
    policyVersion: 3,
    assignmentVersion: 8,
    ...overrides,
  };
}

describe('@supauth/authorization-core', () => {
  it('resolves exactly once and decides only from the in-memory snapshot', async () => {
    let calls = 0;
    const context = await resolveAuthorization(request, async () => {
      calls += 1;
      return snapshot();
    });

    expect(calls).toBe(1);
    expect(decide(context, permission('invoice:read'))).toMatchObject({ allowed: true, reason: 'granted' });
    expect(can(context, permission('invoice:delete'))).toBe(false);
    expect(canAny(context, [permission('invoice:delete'), permission('invoice:update')])).toBe(true);
    expect(canAll(context, [permission('invoice:read'), permission('invoice:update')])).toBe(true);
    expect(canAll(context, [])).toBe(false);
  });

  it('denies missing, inactive, and revoked memberships with 403 semantics', async () => {
    for (const membershipState of ['missing', 'inactive', 'revoked'] as const) {
      const context = await resolveAuthorization(request, async () => snapshot({ membershipState }));
      expect(decide(context, permission('invoice:read')).reason).toBe(`${membershipState}_membership`);
      expect(() => assertCan(context, permission('invoice:read'))).toThrow(AuthorizationForbiddenError);
    }
  });

  it('keeps resolver failure and stale snapshots in the 503 error class', async () => {
    await expect(resolveAuthorization(request, async () => {
      throw new Error('database offline');
    })).rejects.toMatchObject({ status: 503, code: 'authorization_unavailable' });
    await expect(resolveAuthorization(request, async () => snapshot({ expiresAt: resolvedAt - 1 }))).rejects.toBeInstanceOf(
      AuthorizationUnavailableError,
    );
  });

  it('rejects cross-principal, cross-application, and cross-domain snapshots', async () => {
    const mismatches: Partial<AuthorizationSnapshot>[] = [
      { principal: { ...request.principal, kind: 'service' } },
      { applicationId: 'reporting-api' },
      { domain: { ...request.domain, id: 'org-2' } },
    ];
    for (const mismatch of mismatches) {
      await expect(resolveAuthorization(request, async () => snapshot(mismatch))).rejects.toBeInstanceOf(
        AuthorizationUnavailableError,
      );
    }
  });

  it('maps malformed resolver snapshots to 503 without exposing mutable permissions', async () => {
    await expect(resolveAuthorization(request, async () => snapshot({
      permissions: ['invoice:*'],
    }))).rejects.toMatchObject({ status: 503, code: 'authorization_unavailable' });
    await expect(resolveAuthorization(request, async () => snapshot({
      membershipState: 'unknown' as 'active',
    }))).rejects.toBeInstanceOf(AuthorizationUnavailableError);
    await expect(resolveAuthorization(request, async () => snapshot({
      policyVersion: 'v3',
    }))).rejects.toBeInstanceOf(AuthorizationUnavailableError);
    await expect(resolveAuthorization(request, async () => snapshot({
      permissions: [42 as unknown as string],
    }))).rejects.toBeInstanceOf(AuthorizationUnavailableError);
    await expect(resolveAuthorization(request, async () => snapshot({
      membershipState: 'inactive',
      permissions: [42 as unknown as string],
    }))).rejects.toBeInstanceOf(AuthorizationUnavailableError);
    await expect(resolveAuthorization(request, async () => snapshot({
      resolvedAt: Date.now() + 60_000,
      expiresAt: Date.now() + 120_000,
    }))).rejects.toBeInstanceOf(AuthorizationUnavailableError);

    const context = await resolveAuthorization(request, async () => snapshot());
    expect(Object.isFrozen(context.permissions)).toBe(true);
    expect(() => (context.permissions as unknown as string[]).push('invoice:delete')).toThrow();
  });

  it('accepts only canonical resource:action permissions', () => {
    expect(String(permission('invoice:read'))).toBe('invoice:read');
    for (const invalid of ['invoice.read', 'invoice:*', '*:read', 'invoice:read:own', 'Invoice:read']) {
      expect(() => permission(invalid)).toThrow(TypeError);
    }
  });
});
