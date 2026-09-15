import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { serverManagementContracts } from '../../../shared/src/server-management.js';
import { fixtureUser } from './management-contract-fixtures.js';

const effects: string[] = [];
const suspendUser = mock(async (_userId: string, _data: Record<string, unknown> = {}) => {
  effects.push('suspend');
  return fixtureUser('user-one');
});
const logAudit = mock(async () => { effects.push('audit'); });
const dispatchEvent = mock(async () => { effects.push('webhook'); });

mock.module('../supacloud/adapter.js', () => ({
  SupaCloudApiError: class extends Error {},
  getSupaCloudAdapter: () => ({ suspendUser }),
  isSupaCloudApiError: () => false,
}));
mock.module('../repositories/audit.js', () => ({ logAudit }));
mock.module('../repositories/webhook-delivery.js', () => ({
  buildEvent: (type: string, data: unknown) => ({ type, data }),
  dispatchEvent,
}));
const { userRoutes } = await import('../routes/users.js');
const { observabilityMiddleware } = await import('../middleware/index.js');
const app = new Elysia().use(observabilityMiddleware).use(userRoutes);

function request(body?: unknown) {
  return new Request('http://localhost/v1/users/user-one/suspend', {
    method: 'POST',
    ...(body === undefined ? {} : {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
}

describe('suspend historical optional body', () => {
  beforeEach(() => {
    effects.length = 0;
    suspendUser.mockClear();
    logAudit.mockClear();
    dispatchEvent.mockClear();
  });

  test('leaves absent body to the existing adapter default', async () => {
    const response = await app.handle(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(fixtureUser('user-one'));
    expect(suspendUser).toHaveBeenCalledWith('user-one');
    expect(effects).toEqual(['suspend', 'audit', 'webhook']);
    expect(serverManagementContracts['POST /v1/users/:userId/suspend']?.contract.input["required"])
      .not.toContain('body');
  });

  test.each([{}, { ban_duration: '24h' }])('validates present body %j', async (body) => {
    const response = await app.handle(request(body));
    expect(response.status).toBe(200);
    expect(suspendUser).toHaveBeenCalledWith('user-one', body);
    expect(effects).toEqual(['suspend', 'audit', 'webhook']);
  });

  test.each([null, [], { ban_duration: 24 }, { unrelated: true }].map(body => ({ body })))(
    'rejects invalid present body before effects: %j',
    async ({ body }) => {
      const response = await app.handle(request(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: 'invalid_request_body' } });
      expect(effects).toEqual([]);
    },
  );
});
