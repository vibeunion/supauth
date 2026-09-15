import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { accountContract } from '../utils/account-contract.js';
import { decodeSchema } from '../../../shared/src/schema.js';
import { accountEndpoints } from '../../../shared/src/server-account.js';

const audit = mock(async () => {});
const writeStatus = mock(async () => {});
const suspendUser = mock(async () => ({}));
const unsuspendUser = mock(async () => ({}));
const findRecord = mock(async () => ({
  id: 'record-one', externalId: 'user-one', sourceStatus: 'inactive',
  userId: 'user-one', email: 'user@example.test',
}));
mock.module('../repositories/audit.js', () => ({ logAudit: audit }));
mock.module('../supacloud/adapter.js', () => ({
  SupaCloudApiError: class extends Error {},
  getSupaCloudAdapter: () => ({ suspendUser, unsuspendUser }),
  getSupaCloudAdapterForProject: () => ({ suspendUser, unsuspendUser }),
  isSupaCloudApiError: () => false,
}));
mock.module('../repositories/account-provisioning.js', () => ({
  normalizeExternalId: (value: string) => value.normalize('NFKC').trim(),
  findRecordByExternalId: findRecord,
  updateRecordSourceStatus: writeStatus,
}));
const { accountProvisioningRoutes } = await import('../routes/account-provisioning.js');
const { createPublicAccountRoutes } = await import('../routes/account-self-service.js');
const { observabilityMiddleware } = await import('../middleware/index.js');
const provisioning = new Elysia().use(observabilityMiddleware).use(accountProvisioningRoutes);

function post(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('account historical request normalization', () => {
  beforeEach(() => {
    audit.mockClear();
    writeStatus.mockClear();
    suspendUser.mockClear();
    unsuspendUser.mockClear();
    findRecord.mockClear();
  });

  test.each([null, false, 0, '', {}, { ignored: [] }])(
    'retains non-array records as an empty import/sync: %j',
    async (records) => {
      for (const path of ['/import', '/sync']) {
        audit.mockClear();
        const response = await provisioning.handle(post(`/v1/account-provisioning${path}`, {
          records, email_domain: 'example.test',
        }));
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ total: 0, errors: [] });
        expect(audit).toHaveBeenCalledTimes(path === '/import' ? 1 : 0);
        expect(findRecord).not.toHaveBeenCalled();
        expect(writeStatus).not.toHaveBeenCalled();
        expect(suspendUser).not.toHaveBeenCalled();
        expect(unsuspendUser).not.toHaveBeenCalled();
      }
    },
  );

  test('defaults missing sync source_status to active before the typed domain call', async () => {
    const response = await provisioning.handle(post('/v1/account-provisioning/sync', {
      records: [{ external_id: 'user-one' }], dry_run: true,
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      total: 1, unchanged: 0, updated: 1, suspended: 0, reactivated: 1, errors: [],
    });
    expect(findRecord).toHaveBeenCalledWith('user-one', 'employee');
    expect(audit).toHaveBeenCalledTimes(1);
    expect(writeStatus).not.toHaveBeenCalled();
    expect(suspendUser).not.toHaveBeenCalled();
    expect(unsuspendUser).not.toHaveBeenCalled();
  });

  test.each([[null], [{ external_id: 1 }], [{ unrelated: true }]].map(records => ({ records })))(
    'still rejects invalid array rows before lookup or writes: %j',
    async ({ records }) => {
      for (const path of ['/import', '/sync']) {
        const response = await provisioning.handle(post(`/v1/account-provisioning${path}`, { records }));
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: { code: 'invalid_request_body' } });
        expect(findRecord).not.toHaveBeenCalled();
        expect(audit).not.toHaveBeenCalled();
      }
    },
  );

  test('JSON validation still rejects nested undefined in ignored record containers', () => {
    expect(() => decodeSchema(accountEndpoints.import.input, {
      body: { records: { ignored: undefined } },
    })).toThrow();
  });

  test.each([null, false, 0, {}, []].map(challenge => ({ challenge })))(
    'preserves non-string challenge aliases as a fresh challenge: %j',
    async ({ challenge }) => {
      for (const alias of ['challenge_id', 'challengeId']) {
        const verify = mock(async (_token: string, id: string, _input: unknown) => ({
          ok: true as const,
          data: { id, access_token: 'fixture-access', refresh_token: 'fixture-refresh' },
        }));
        const app = new Elysia().use(observabilityMiddleware).use(createPublicAccountRoutes({
          getAccount: async () => ({ ok: true, user: { id: 'user-one' } }),
          getConfig: async () => ({
            enabled: true,
            profile: { edit_mode: 'editable', fields: [] },
            security: { password_change: true, mfa: true, email_change: true, phone_change: true },
            grants: { enabled: true }, identities: { enabled: true },
            delete_account: { enabled: true, url: null },
          }),
          verifyTotpMfa: verify,
          auditEvent: async () => {},
        }));
        const request = post('/v1/public/account/mfa/factor-one/verify', { code: '123456', [alias]: challenge });
        request.headers.set('authorization', 'Bearer fixture');
        const response = await app.handle(request);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ success: true, status: 'verified' });
        expect(verify).toHaveBeenCalledWith('fixture', 'factor-one', { code: '123456', challengeId: null });
      }
    },
  );

  test('documents enrollment body as optional without weakening normalized validation', () => {
    expect(accountContract('enroll', {}).detail.requestBody?.required).toBe(false);
    expect(accountContract('enroll', {}).detail['x-supauth-normalized-input']).toBeDefined();
  });
});
