import { describe, expect, test } from 'bun:test';
import { defineHttpOperation } from '../http/operation.js';

function invokeWithStatus(status: number | string) {
  return defineHttpOperation('GET', '/status', ({ set }) => {
    set.status = status;
    return { ok: true };
  }).invoke({ request: new Request('http://localhost/status') });
}

describe('HTTP operation response status', () => {
  test('preserves Node-compatible named status values without the node:http builtin', async () => {
    expect((await invokeWithStatus('Not Found')).status).toBe(404);
    expect((await invokeWithStatus('Internal Server Error')).status).toBe(500);
  });

  test('keeps numeric status support and rejects unknown names', async () => {
    expect((await invokeWithStatus(202)).status).toBe(202);
    expect((await invokeWithStatus('Missing Status')).status).toBe(502);
  });
});
