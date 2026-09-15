import { describe, expect, it, spyOn } from 'bun:test';
import { Elysia, t } from 'elysia';
import { observabilityMiddleware } from '../middleware/index.js';
import { ApiContractError } from '../utils/api-contract.js';
import { decodeSchema } from '../../../shared/src/schema.js';
import { ServerErrorSchema } from '../../../shared/src/server-contracts.js';

describe('unhandled error boundary', () => {
  it('redacts unknown failures in both the response and request log', async () => {
    const logs: unknown[][] = [];
    const logger = spyOn(console, 'error').mockImplementation((...values: unknown[]) => { logs.push(values); });
    try {
      const app = new Elysia().use(observabilityMiddleware).get('/probe', () => {
        throw new Error('fixture-private-configuration');
      });
      const response = await app.handle(new Request('http://localhost/probe', {
        headers: { 'x-request-id': 'contract-probe' },
      }));
      const payload: unknown = await response.json();
      expect(response.status).toBe(500);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(decodeSchema(ServerErrorSchema, payload)).toEqual({
        success: false, error: {
          code: 'internal_server_error', message: 'Internal server error', correlation_id: 'contract-probe',
        },
      });
      expect(JSON.stringify(logs)).not.toContain('fixture-private-configuration');
    } finally {
      logger.mockRestore();
    }
  });

  it('preserves framework statuses while validating every generated error envelope', async () => {
    const logger = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const app = new Elysia().use(observabilityMiddleware)
        .post('/validated', ({ body }) => body, { body: t.Object({ name: t.String() }) })
        .get('/bad-details', () => { throw new ApiContractError(400, 'probe', 'probe', { binding_count: 'invalid' }); });
      for (const [request, expected] of [
        [new Request('http://localhost/missing'), 404],
        [new Request('http://localhost/validated', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }), 400],
        [new Request('http://localhost/validated', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":1}' }), 422],
        [new Request('http://localhost/bad-details'), 500],
      ] as const) {
        const response = await app.handle(request);
        expect(response.status).toBe(expected);
        const payload: unknown = await response.json();
        expect(decodeSchema(ServerErrorSchema, payload).success).toBe(false);
      }
    } finally {
      logger.mockRestore();
    }
  });
});
