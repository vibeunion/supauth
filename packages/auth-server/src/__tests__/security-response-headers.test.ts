import { describe, expect, test } from 'bun:test';
import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';
import { ApiContractError } from '../utils/api-contract.js';
import { observabilityMiddleware } from '../middleware/index.js';

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
});
