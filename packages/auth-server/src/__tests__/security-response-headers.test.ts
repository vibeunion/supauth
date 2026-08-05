import { describe, expect, test } from 'bun:test';
import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';
import { ApiContractError } from '../utils/api-contract.js';
import { observabilityMiddleware } from '../middleware/index.js';
import { SupaCloudApiError } from '../supacloud/adapter.js';

const expectedHeaders = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

const app = new Elysia()
  .use(observabilityMiddleware)
  .use(cors({ origin: ['https://client.example.test'], credentials: true }))
  .get('/ok', () => ({ success: true }))
  .get('/raw', () => new Response('<!doctype html>', {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Strict-Transport-Security': 'max-age=0',
      'X-Content-Type-Options': 'off',
      'X-Frame-Options': 'ALLOW',
      'Referrer-Policy': 'unsafe-url',
      'Permissions-Policy': '*',
    },
  }))
  .get('/error', () => {
    throw new ApiContractError(502, 'upstream_failed', 'Upstream failed');
  })
  .get('/validation-400', () => {
    throw new SupaCloudApiError(
      400,
      JSON.stringify({
        message: 'slug must contain 2 to 120 URL-safe characters',
        code: 'VALIDATION_ERROR',
      }),
      '/v1/organizations',
    );
  })
  .get('/validation-422', () => {
    throw new SupaCloudApiError(
      422,
      JSON.stringify({ code: 'VALIDATION_ERROR', message: 'internal detail' }),
      '/v1/organizations',
    );
  })
  .get('/unknown-400', () => {
    throw new SupaCloudApiError(
      400,
      JSON.stringify({ code: 'CONFLICT', message: 'duplicate organization' }),
      '/v1/organizations',
    );
  })
  .get('/upstream-500', () => {
    throw new SupaCloudApiError(500, 'internal upstream failure', '/v1/organizations');
  });

function expectSecurityHeaders(response: Response) {
  for (const [name, expected] of Object.entries(expectedHeaders)) {
    expect(response.headers.get(name)).toBe(expected);
  }
}

describe('Function security response headers', () => {
  test('protects successful responses', async () => {
    const response = await app.handle(new Request('https://auth.example.test/ok'));

    expect(response.status).toBe(200);
    expectSecurityHeaders(response);
  });

  test('overrides conflicting headers on raw hosted-page responses', async () => {
    const response = await app.handle(new Request('https://auth.example.test/raw', {
      headers: { Origin: 'https://client.example.test' },
    }));

    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('access-control-allow-origin')).toBe('https://client.example.test');
    expectSecurityHeaders(response);
  });

  test('protects normalized error responses', async () => {
    const response = await app.handle(new Request('https://auth.example.test/error'));

    expect(response.status).toBe(502);
    expectSecurityHeaders(response);
  });

  test.each([400, 422])(
    'normalizes structured %d validation errors without exposing upstream details',
    async status => {
      const response = await app.handle(
        new Request(`https://auth.example.test/validation-${status}`),
      );

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({
        success: false,
        error: {
          code: 'validation_error',
          message: 'Request validation failed',
          correlation_id: expect.any(String),
          details: { path: '/v1/organizations' },
        },
      });
      expectSecurityHeaders(response);
    },
  );

  test('preserves unknown 400 and sanitized 5xx behavior', async () => {
    const badRequest = await app.handle(
      new Request('https://auth.example.test/unknown-400'),
    );
    const unavailable = await app.handle(
      new Request('https://auth.example.test/upstream-500'),
    );

    expect(badRequest.status).toBe(400);
    expect(await badRequest.json()).toMatchObject({
      error: {
        code: 'supacloud_upstream_error',
        message: '{"code":"CONFLICT","message":"duplicate organization"}',
      },
    });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({
      error: {
        code: 'supacloud_upstream_error',
        message: 'SupaCloud Management API is unavailable',
      },
    });
  });
});
