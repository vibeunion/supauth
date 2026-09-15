import { beforeEach, describe, expect, mock, test } from 'bun:test';

const resultModule: unknown = await import(new URL('../../node_modules/postgres/src/result.js', import.meta.url).href);
if (!resultModule || typeof resultModule !== 'object' || !('default' in resultModule)
  || typeof resultModule.default !== 'function') throw new Error('Installed postgres Result is unavailable');
const InstalledResult = resultModule.default;
function driverResult(rows: unknown[]) {
  const result: unknown = Reflect.construct(InstalledResult, []);
  if (!Array.isArray(result)) throw new Error('Installed postgres Result is not an array');
  result.push(...rows);
  return result;
}

const flags = [
  'authorize_exists', 'has_permission_exists', 'has_org_permission_exists',
  'current_project_claims_exists', 'current_permission_claims_exists',
  'legacy_webhooks_absent', 'legacy_webhook_deliveries_absent',
  'authorize_granted', 'has_permission_granted', 'has_org_permission_granted',
  'current_project_claims_granted', 'current_permission_claims_granted',
  'current_permission_claims_public_revoked', 'current_permission_claims_anon_revoked',
  'current_permission_claims_security_definer', 'current_permission_claims_search_path_hardened',
];
const validHelper = Object.fromEntries(flags.map(key => [key, true]));
const validPolicy = {
  schemaname: 'public', tablename: 'fixture', policyname: 'fixture',
  qual: "auth.jwt()->>'role' = 'reader'", with_check: null,
};
let helperRows: unknown = [validHelper];
let policyRows: unknown = [validPolicy];
let queryIndex = 0;
const end = mock(async () => {});
const sql = Object.assign(async () => {
  queryIndex += 1;
  return queryIndex === 1 ? [] : queryIndex === 2 ? helperRows : policyRows;
}, { end });
mock.module('postgres', () => ({ default: () => sql }));
const { verifyRbacAgainstDatabase } = await import('../compatibility/rbac-verify.js');
const verify = () => verifyRbacAgainstDatabase('postgres://fixture-only');

beforeEach(() => {
  helperRows = [validHelper];
  policyRows = [validPolicy];
  queryIndex = 0;
  end.mockClear();
});

describe('RBAC database projection boundary', () => {
  test('accepts the installed driver Result metadata without trusting its rows', async () => {
    const helperResult = driverResult([validHelper]);
    helperRows = helperResult;
    policyRows = driverResult([validPolicy]);
    expect(Reflect.ownKeys(helperResult)).toEqual(expect.arrayContaining([
      'count', 'state', 'command', 'columns', 'statement',
    ]));
    expect(await verify()).toMatchObject({
      reachable: true, authorizeExists: true, unsafePolicies: [validPolicy],
    });
    expect(queryIndex).toBe(3);
    expect(end).toHaveBeenCalledTimes(1);
  });

  test('accepts empty installed Result containers with fail-closed helper flags', async () => {
    helperRows = driverResult([]);
    policyRows = driverResult([]);
    expect(await verify()).toMatchObject({
      reachable: true, authorizeExists: false, authorizeGranted: false, unsafePolicies: [],
    });
    expect(end).toHaveBeenCalledTimes(1);
  });

  test('rejects a bad helper row inside an actual Result', async () => {
    helperRows = driverResult([{ ...validHelper, authorize_exists: 'true' }]);
    policyRows = driverResult([]);
    expect(await verify()).toEqual({
      reachable: false, error: 'RBAC verification returned an invalid database row',
    });
    expect(queryIndex).toBe(2);
    expect(end).toHaveBeenCalledTimes(1);
  });

  test('rejects a bad policy row inside an actual Result', async () => {
    helperRows = driverResult([validHelper]);
    policyRows = driverResult([{ ...validPolicy, with_check: { private: 'fixture-only' } }]);
    expect(await verify()).toEqual({
      reachable: false, error: 'RBAC verification returned an invalid database row',
    });
    expect(queryIndex).toBe(3);
    expect(end).toHaveBeenCalledTimes(1);
  });

  test('does not treat an arbitrary iterable as a database result', async () => {
    helperRows = new Set([validHelper]);
    expect(await verify()).toEqual({
      reachable: false, error: 'RBAC verification returned an invalid database row',
    });
  });

  test('retains boolean flags and nullable SQL expressions', async () => {
    const result = await verify();
    expect(result.reachable).toBe(true);
    expect(result.authorizeExists).toBe(true);
    expect(result.currentPermissionClaimsSearchPathHardened).toBe(true);
    expect(result.unsafePolicies).toEqual([validPolicy]);
    expect(end).toHaveBeenCalledTimes(1);
  });

  test('null or absent helper rows still yield false without granting access', async () => {
    helperRows = [Object.fromEntries(flags.map(key => [key, null]))];
    expect(await verify()).toMatchObject({ reachable: true, authorizeExists: false, authorizeGranted: false });
    helperRows = [];
    queryIndex = 0;
    expect(await verify()).toMatchObject({ reachable: true, authorizeExists: false, authorizeGranted: false });
  });

  test.each(['true', 1, {}, undefined].map(flag => ({ flag })))(
    'fails closed on malformed helper projections: %j', async ({ flag }) => {
      helperRows = [{ ...validHelper, authorize_exists: flag }];
      expect(await verify()).toEqual({
        reachable: false, error: 'RBAC verification returned an invalid database row',
      });
      expect(queryIndex).toBe(2);
      expect(end).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    { ...validPolicy, qual: { private: 'fixture-only' } },
    { ...validPolicy, with_check: 17 },
    { ...validPolicy, policyname: null },
    null,
  ].map(row => ({ row })))('rejects malformed policy rows with a fixed error: %j', async ({ row }) => {
    policyRows = [row];
    expect(await verify()).toEqual({
      reachable: false, error: 'RBAC verification returned an invalid database row',
    });
    expect(end).toHaveBeenCalledTimes(1);
  });
});
