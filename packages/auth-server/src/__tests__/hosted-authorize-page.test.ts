import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { hostedOAuthPageRoutes } from '../routes/sign-in-experience.js';

function request(url: string, init?: RequestInit) {
  const app = new Elysia().use(hostedOAuthPageRoutes);
  return app.handle(
    new Request(url, {
      ...init,
    }),
  );
}

describe('hostedOAuthPageRoutes', () => {
  test('GET /oauth/authorize serves hosted authorize html', async () => {
    const response = await request('http://localhost/oauth/authorize?authorization_id=test-authz');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('<title>SupaOAuth Sign In</title>');
    expect(body).toContain('authorization_id');
  });

  test('injects same-origin public API base for custom auth domains', async () => {
    const response = await request('https://login.example.com/oauth/authorize?authorization_id=test-authz');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('window.__SUPAOAUTH_PUBLIC_API_BASE__ = "https://login.example.com/v1/public";');
    expect(body).not.toContain('hostname.startsWith(\'auth.\')');
    expect(body).not.toContain('/api/v1/public');
  });
});
