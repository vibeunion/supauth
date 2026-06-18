import { describe, expect, it } from 'bun:test';
import {
  buildGoTrueOAuthAuthorizeUrl,
  createSsoAuthorizeRoutes,
  isSafeRedirectUriSyntax,
  isSafeOAuthClientId,
  publicOriginFromRequest,
} from '../routes/sso-authorize.js';

function createTestApp() {
  return createSsoAuthorizeRoutes('/oauth/sso', {
    publicBaseUrl: '',
    trustProxyHeaders: false,
  });
}

describe('GoTrue-compatible SSO authorize entrypoint', () => {
  it('validates redirect_uri syntax before handing off to GoTrue', () => {
    expect(isSafeRedirectUriSyntax('https://app.example.test/callback')).toBe(true);
    expect(isSafeRedirectUriSyntax('http://app.example.test/callback')).toBe(true);
    expect(isSafeRedirectUriSyntax('https://evil.example.test/callback')).toBe(true);
    expect(isSafeRedirectUriSyntax('https://app.example.test/callback#fragment')).toBe(false);
    expect(isSafeRedirectUriSyntax('javascript:alert(1)')).toBe(false);
    expect(isSafeRedirectUriSyntax('not a url')).toBe(false);
  });

  it('rejects unsafe client_id before redirecting to GoTrue', async () => {
    const app = createSsoAuthorizeRoutes('/oauth/sso', {
      publicBaseUrl: '',
      trustProxyHeaders: false,
    });

    const response = await app.handle(new Request(
      'http://localhost/oauth/sso/authorize?response_type=code&client_id=..%2F..%2Fconfig%2Fauth&redirect_uri=https%3A%2F%2Fapp.example.test%2Fcallback',
    ));

    expect(response.status).toBe(400);
    const payload = await response.json() as { error: string; error_description: string };
    expect(payload.error).toBe('invalid_request');
    expect(payload.error_description).toContain('client_id');
  });

  it('validates OAuth client IDs used by public SSO entrypoints', () => {
    expect(isSafeOAuthClientId('app_123')).toBe(true);
    expect(isSafeOAuthClientId('client-abc.123')).toBe(true);
    expect(isSafeOAuthClientId('../../config/auth')).toBe(false);
    expect(isSafeOAuthClientId('client/secret')).toBe(false);
    expect(isSafeOAuthClientId('client?x=y')).toBe(false);
    expect(isSafeOAuthClientId('client#fragment')).toBe(false);
  });

  it('builds GoTrue OAuth authorize URL and preserves prompt=none', () => {
    const url = buildGoTrueOAuthAuthorizeUrl('https://runtime.example.test/auth/v1', {
      response_type: 'code',
      client_id: 'app_123',
      redirect_uri: 'https://app.example.test/callback',
      scope: 'openid email',
      state: 'state-1',
      prompt: 'none',
      ignored: 'nope',
    });

    expect(url.toString()).toStartWith('https://runtime.example.test/auth/v1/oauth/authorize?');
    expect(url.searchParams.get('client_id')).toBe('app_123');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.test/callback');
    expect(url.searchParams.get('prompt')).toBe('none');
    expect(url.searchParams.has('ignored')).toBe(false);
  });

  it('ignores forwarded gateway headers unless trusted proxy mode is enabled', () => {
    const request = new Request('http://127.0.0.1/functions/v1/supauth/oauth/sso/authorize', {
      headers: {
        host: '127.0.0.1:9000',
        'x-forwarded-host': 'auth.example.test',
        'x-forwarded-proto': 'https',
      },
    });

    expect(publicOriginFromRequest(request)).toBe('http://127.0.0.1:9000');
  });

  it('derives public origin from forwarded gateway headers in trusted proxy mode', () => {
    const request = new Request('http://127.0.0.1/functions/v1/supauth/oauth/sso/authorize', {
      headers: {
        host: '127.0.0.1:9000',
        'x-forwarded-host': 'auth.example.test',
        'x-forwarded-proto': 'https',
      },
    });

    expect(publicOriginFromRequest(request, true)).toBe('https://auth.example.test');
  });

  it('redirects valid requests to hosted GoTrue path without leaking the project runtime host', async () => {
    const app = createTestApp();
    const response = await app.handle(new Request(
      'https://auth.example.test/oauth/sso/authorize?response_type=code&client_id=app_123&redirect_uri=https%3A%2F%2Fapp.example.test%2Fcallback&scope=openid%20email&state=abc&prompt=none',
    ));

    expect(response.status).toBe(302);
    const location = response.headers.get('location') || '';
    expect(location).toStartWith('https://auth.example.test/auth/v1/oauth/authorize?');
    const redirect = new URL(location);
    expect(redirect.searchParams.get('client_id')).toBe('app_123');
    expect(redirect.searchParams.get('state')).toBe('abc');
    expect(redirect.searchParams.get('prompt')).toBe('none');
  });

  it('prefers configured custom auth domain over request host', async () => {
    const app = createSsoAuthorizeRoutes('/oauth/sso', {
      publicBaseUrl: 'https://auth.example.test/',
      trustProxyHeaders: false,
    });

    const response = await app.handle(new Request(
      'https://project-runtime.example.test/oauth/sso/authorize?response_type=code&client_id=app_123&redirect_uri=https%3A%2F%2Fapp.example.test%2Fcallback&scope=openid%20email',
    ));

    expect(response.status).toBe(302);
    const location = response.headers.get('location') || '';
    expect(location).toStartWith('https://auth.example.test/auth/v1/oauth/authorize?');
  });

  it('uses trusted forwarded host only when no custom auth domain is configured', async () => {
    const app = createSsoAuthorizeRoutes('/oauth/sso', {
      publicBaseUrl: '',
      trustProxyHeaders: true,
    });

    const response = await app.handle(new Request(
      'http://127.0.0.1:9000/oauth/sso/authorize?response_type=code&client_id=app_123&redirect_uri=https%3A%2F%2Fapp.example.test%2Fcallback',
      {
        headers: {
          'x-forwarded-host': 'auth.example.test',
          'x-forwarded-proto': 'https',
        },
      },
    ));

    expect(response.status).toBe(302);
    const location = response.headers.get('location') || '';
    expect(location).toStartWith('https://auth.example.test/auth/v1/oauth/authorize?');
  });

  it('rejects redirect_uri fragments before redirecting', async () => {
    const app = createTestApp();
    const response = await app.handle(new Request(
      'http://localhost/oauth/sso/authorize?response_type=code&client_id=app_123&redirect_uri=https%3A%2F%2Fapp.example.test%2Fcallback%23fragment',
    ));

    expect(response.status).toBe(400);
    const payload = await response.json() as { error: string; error_description: string };
    expect(payload.error).toBe('invalid_request');
    expect(payload.error_description).toContain('without a fragment');
  });

  it('does not redirect arbitrary redirect_uri for unsupported response_type', async () => {
    const app = createTestApp();
    const response = await app.handle(new Request(
      'http://localhost/oauth/sso/authorize?response_type=token&client_id=app_123&redirect_uri=https%3A%2F%2Fapp.example.test%2Fcallback&state=abc',
    ));

    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    const payload = await response.json() as { error: string };
    expect(payload.error).toBe('unsupported_response_type');
  });

  it('redirects valid requests to GoTrue without requiring SupaCloud Management API', async () => {
    const app = createTestApp();
    const response = await app.handle(new Request(
      'https://auth.example.test/oauth/sso/authorize?response_type=code&client_id=app_123&redirect_uri=https%3A%2F%2Fapp.example.test%2Fcallback&scope=openid%20email',
    ));

    expect(response.status).toBe(302);
    const location = response.headers.get('location') || '';
    expect(location).toStartWith('https://auth.example.test/auth/v1/oauth/authorize?');
    const redirect = new URL(location);
    expect(redirect.searchParams.get('client_id')).toBe('app_123');
    expect(redirect.searchParams.get('redirect_uri')).toBe('https://app.example.test/callback');
  });
});
