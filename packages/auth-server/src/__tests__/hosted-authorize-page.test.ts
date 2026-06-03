import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { hostedPageRoutes } from '../routes/hosted-pages.js';

function request(url: string, init?: RequestInit) {
  const app = new Elysia().use(hostedPageRoutes);
  return app.handle(new Request(url, { ...init }));
}

describe('hostedPageRoutes', () => {
  test('GET /oauth/authorize serves hosted authorize html', async () => {
    const response = await request('http://localhost/oauth/authorize?authorization_id=test-authz');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('<title>SupaOAuth Sign In</title>');
  });

  test('GET /login.html serves the same authorize page', async () => {
    const response = await request('http://localhost/login.html');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('<title>SupaOAuth Sign In</title>');
  });

  test('GET / serves the same authorize page', async () => {
    const response = await request('http://localhost/');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('<title>SupaOAuth Sign In</title>');
  });
});
