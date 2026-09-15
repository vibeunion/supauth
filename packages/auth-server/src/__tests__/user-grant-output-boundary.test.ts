import { describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';

let upstream: unknown;
const listUserOAuthGrants = mock(async () => upstream);
mock.module('../supacloud/adapter.js', () => ({
  SupaCloudApiError: class extends Error {},
  isSupaCloudApiError: () => false,
  getSupaCloudAdapter: () => ({ listUserOAuthGrants }),
}));
mock.module('../repositories/audit.js', () => ({ logAudit: mock(async () => {}) }));
mock.module('../repositories/webhook-delivery.js', () => ({
  buildEvent: mock(() => ({})), dispatchEvent: mock(async () => {}),
}));
const { userRoutes } = await import('../routes/users.js');
const { observabilityMiddleware } = await import('../middleware/index.js');
const app = new Elysia().use(observabilityMiddleware).use(userRoutes);
const request = () => new Request('http://localhost/v1/users/user-one/grants');

describe('user grant collection boundary', () => {
  test.each([null, [], 'not-a-grant', 123, { client_id: 123 }].map(item => ({ item })))(
    'rejects invalid items instead of promoting pagination elements to records: %j',
    async ({ item }) => {
      upstream = { items: [item], total: 1 };
      const response = await app.handle(request());
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ error: { code: 'invalid_upstream_response' } });
    },
  );

  test('retains grant fields, authoritative source and page metadata after decoding', async () => {
    upstream = { items: [{ client_id: 'client-one', scopes: ['openid'] }], total: 6, page: 2, limit: 1 };
    const response = await app.handle(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [{ client_id: 'client-one', scopes: ['openid'], source: 'gotrue' }],
      total: 6, page: 2, limit: 1,
    });
  });
});
