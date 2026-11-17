import { describe, expect, it, spyOn } from 'bun:test';
import { Elysia } from 'elysia';
import { observabilityMiddleware } from '../middleware/index.js';
import { defineHttpOperation } from '../http/operation.js';
import { SupaCloudApiError } from '../supacloud/adapter.js';

// vibeunion/supauth#144：503 必须带 Retry-After，客户端才能区分瞬时故障与确定性失败。

describe('upstream 503 Retry-After contract', () => {
  it('adds a conservative Retry-After to middleware 503 responses', async () => {
    const logger = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const app = new Elysia().use(observabilityMiddleware).get('/probe', () => {
        throw new SupaCloudApiError(503, 'runtime unavailable', '/v1/probe');
      });
      const response = await app.handle(new Request('http://localhost/probe'));
      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('2');
    } finally {
      logger.mockRestore();
    }
  });

  it('passes the upstream Retry-After hint through to the client', async () => {
    const logger = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const app = new Elysia().use(observabilityMiddleware).get('/probe', () => {
        throw new SupaCloudApiError(503, 'runtime unavailable', '/v1/probe', 7);
      });
      const response = await app.handle(new Request('http://localhost/probe'));
      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('7');
    } finally {
      logger.mockRestore();
    }
  });

  it('does not advertise Retry-After for non-retryable failures', async () => {
    const logger = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const app = new Elysia().use(observabilityMiddleware).get('/probe', () => {
        throw new SupaCloudApiError(404, 'missing', '/v1/probe');
      });
      const response = await app.handle(new Request('http://localhost/probe'));
      expect(response.status).toBe(404);
      expect(response.headers.get('retry-after')).toBeNull();
    } finally {
      logger.mockRestore();
    }
  });

  it('adds Retry-After on the operation invoke error path', async () => {
    const logger = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const operation = defineHttpOperation('GET', '/probe', () => {
        throw new SupaCloudApiError(503, 'runtime unavailable', '/v1/probe', 3);
      });
      const response = await operation.invoke({ request: new Request('http://localhost/probe') });
      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('3');
    } finally {
      logger.mockRestore();
    }
  });
});