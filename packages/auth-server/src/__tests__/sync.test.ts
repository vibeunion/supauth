import { describe, it, expect } from 'bun:test';
import { Elysia } from 'elysia';

describe('Legacy metadata sync routes', () => {
  it('fails closed before any direct GoTrue metadata writer can run', async () => {
    const [{ syncRoutes }, { observabilityMiddleware }] = await Promise.all([
      import('../routes/sync.js'),
      import('../middleware/index.js'),
    ]);
    const app = new Elysia().use(observabilityMiddleware).use(syncRoutes);

    const responses = await Promise.all([
      app.handle(new Request('http://localhost/v1/sync/user/user-one', { method: 'POST' })),
      app.handle(new Request('http://localhost/v1/sync/org/org-one', { method: 'POST' })),
    ]);

    expect(responses.map((response) => response.status)).toEqual([501, 501]);
    for (const response of responses) {
      const payload = await response.json() as { error: { code: string; details: { capability: string } } };
      expect(payload.error.code).toBe('capability_unavailable');
      expect(payload.error.details.capability).toBe('supacloud_rbac_metadata_sync');
    }
  });
});
