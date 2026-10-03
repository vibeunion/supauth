import { describe, expect, test } from 'bun:test';
import { accountContract, readAccountInput } from '../utils/account-contract.js';
import { defineHttpOperation } from '../http/operation.js';
import { operationTestPlugin } from './http-fixture.js';

describe('server response maps validate newline keys', () => {
  for (const native of [false, true]) {
    test(`preserves valid count values in ${native ? 'native Response' : 'plain JSON'}`, async () => {
      const output = { external_type: 'employee', counts: { 'active\nstatus': 1 } };
      const operation = defineHttpOperation('GET', '/status', ({ request }) => {
        readAccountInput('syncStatus', request, { query: {} });
        return native ? Response.json(output) : output;
      }, accountContract('syncStatus', {}));
      const app = operationTestPlugin({ prefix: '', operations: [operation] });
      const response = await app.handle(new Request('http://localhost/status'));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(output);
    });

    test(`rejects invalid count values in ${native ? 'native Response' : 'plain JSON'}`, async () => {
      const output = { external_type: 'employee', counts: { 'active\nstatus': 'not-a-number' } };
      const operation = defineHttpOperation('GET', '/status', ({ request }) => {
        readAccountInput('syncStatus', request, { query: {} });
        return native ? Response.json(output) : output;
      }, accountContract('syncStatus', {}));
      const app = operationTestPlugin({ prefix: '', operations: [operation] });
      const response = await app.handle(new Request('http://localhost/status'));
      expect(response.status).toBe(502);
      const text = await response.text();
      expect(JSON.parse(text)).toMatchObject({ error: { code: 'invalid_upstream_response' } });
      expect(text).not.toContain('not-a-number');
      expect(text).not.toContain('active');
    });
  }
});
