import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { accountContract, readAccountInput } from '../utils/account-contract.js';
import { observabilityMiddleware } from '../middleware/index.js';

describe('server response maps validate newline keys', () => {
  for (const native of [false, true]) {
    test(`preserves valid count values in ${native ? 'native Response' : 'plain JSON'}`, async () => {
      const output = { external_type: 'employee', counts: { 'active\nstatus': 1 } };
      const app = new Elysia().use(observabilityMiddleware).get('/status', ({ request }) => {
        readAccountInput('syncStatus', request, { query: {} });
        return native ? Response.json(output) : output;
      }, accountContract('syncStatus', {}));
      const response = await app.handle(new Request('http://localhost/status'));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(output);
    });

    test(`rejects invalid count values in ${native ? 'native Response' : 'plain JSON'}`, async () => {
      const output = { external_type: 'employee', counts: { 'active\nstatus': 'not-a-number' } };
      const app = new Elysia().use(observabilityMiddleware).get('/status', ({ request }) => {
        readAccountInput('syncStatus', request, { query: {} });
        return native ? Response.json(output) : output;
      }, accountContract('syncStatus', {}));
      const response = await app.handle(new Request('http://localhost/status'));
      expect(response.status).toBe(502);
      const text = await response.text();
      expect(JSON.parse(text)).toMatchObject({ error: { code: 'invalid_upstream_response' } });
      expect(text).not.toContain('not-a-number');
      expect(text).not.toContain('active');
    });
  }
});
