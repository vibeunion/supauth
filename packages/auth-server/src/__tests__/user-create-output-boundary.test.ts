import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';

const validUser = {
  id: 'user-one', aud: 'authenticated', role: 'authenticated',
  app_metadata: {}, user_metadata: {}, created_at: '2026-09-08T00:00:00.000Z',
};
let upstream: unknown = validUser;
const effects: string[] = [];
const createUser = mock(async () => upstream);
const logAudit = mock(async () => { effects.push('audit'); });
const buildEvent = mock((type: string, data: unknown) => ({ type, data }));
const dispatchEvent = mock(async () => { effects.push('webhook'); });

mock.module('../supacloud/adapter.js', () => ({
  SupaCloudApiError: class extends Error {},
  getSupaCloudAdapter: () => ({ createUser }),
  isSupaCloudApiError: () => false,
}));
mock.module('../repositories/audit.js', () => ({ logAudit }));
mock.module('../repositories/webhook-delivery.js', () => ({ buildEvent, dispatchEvent }));
const { userRoutes } = await import('../routes/users.js');
const { observabilityMiddleware } = await import('../middleware/index.js');
const app = new Elysia().use(observabilityMiddleware).use(userRoutes);
const request = () => new Request('http://localhost/v1/users', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'user@example.test' }),
});

describe('created user output trust boundary', () => {
  beforeEach(() => {
    upstream = validUser;
    effects.length = 0;
    createUser.mockClear();
    logAudit.mockClear();
    buildEvent.mockClear();
    dispatchEvent.mockClear();
  });

  test.each([{ id: 123 }, { ...validUser, created_at: 123 }])(
    'rejects invalid upstream users before deriving audit and notification effects: %j',
    async (invalidUser) => {
      upstream = invalidUser;
      const response = await app.handle(request());
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ error: { code: 'invalid_upstream_response' } });
      expect(createUser).toHaveBeenCalledTimes(1);
      expect(logAudit).not.toHaveBeenCalled();
      expect(buildEvent).not.toHaveBeenCalled();
      expect(dispatchEvent).not.toHaveBeenCalled();
    },
  );

  test('validates the redacted user then preserves audit and notification order', async () => {
    upstream = { ...validUser, password: 'never-public' };
    const response = await app.handle(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...validUser, secret_configured: true });
    expect(effects).toEqual(['audit', 'webhook']);
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(buildEvent).toHaveBeenCalledWith('user.created', { user_id: 'user-one' });
  });
});
