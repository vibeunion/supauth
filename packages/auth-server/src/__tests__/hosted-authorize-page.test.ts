import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { hostedPageRoutes, resolveHostedPagePaths } from '../routes/hosted-pages.js';

function request(url: string, init?: RequestInit) {
  const app = new Elysia().use(hostedPageRoutes);
  return app.handle(new Request(url, { ...init }));
}

describe('hostedPageRoutes', () => {
  test('resolveHostedPagePaths covers src and dist execution layouts', () => {
    const fromSrc = resolveHostedPagePaths('/opt/supauth/packages/auth-server/src/routes', '/opt/supauth/packages/auth-server');
    expect(fromSrc.authorizeHtmlCandidates).toContain('/opt/supauth/packages/admin-console/build/authorize.html');
    expect(fromSrc.customUiDirs).toContain('/opt/supauth/packages/auth-server/custom-ui');

    const fromDist = resolveHostedPagePaths('/opt/supauth/packages/auth-server/dist', '/opt/supauth');
    expect(fromDist.authorizeHtmlCandidates).toContain('/opt/supauth/packages/admin-console/build/authorize.html');
    expect(fromDist.customUiDirs).toContain('/opt/supauth/packages/auth-server/custom-ui');
  });

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

  test('hosted login page normalizes credentials and maps GoTrue login errors', async () => {
    const response = await request('http://localhost/login.html');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('<form id="login-form" novalidate>');
    expect(body).toContain('function normalizeEmailInput(value)');
    expect(body).toContain("invalidLoginCredentials: 'Account or password does not match. Please check and try again.'");
    expect(body).toContain("invalidLoginCredentials: '账号或密码不匹配，请检查后重试。'");
    expect(body).toContain("value.includes('invalid login credentials')");
    expect(body).toContain("value.includes('invalid_credentials')");
    expect(body).toContain("setMessage('error', loginResponseMessage(data))");
    expect(body).toContain('const email = normalizeEmailInput(emailInput.value);');
    expect(body).toContain("setMessage('error', t('emailInvalid'))");
    expect(body).toContain("setMessage('error', t('passwordRequired'))");
  });

  test('GET / serves the same authorize page', async () => {
    const response = await request('http://localhost/');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('<title>SupaOAuth Sign In</title>');
  });
});
