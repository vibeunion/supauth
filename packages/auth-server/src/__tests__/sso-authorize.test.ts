import { describe, expect, it } from 'bun:test';
import {
  buildGoTrueOAuthAuthorizeUrl,
  createSsoAuthorizeRoutes,
  isRedirectUriAllowed,
  isSafeOAuthClientId,
} from '../routes/sso-authorize.js';

const oauthClient = {
  client_id: 'app_123',
  redirect_uris: [
    'https://app.example.test/callback',
    'https://app.example.test/alt-callback',
  ],
  grant_types: ['authorization_code'],
};

function createTestApp(client = oauthClient) {
  return createSsoAuthorizeRoutes('/oauth/sso', {
    async getOAuthClient(clientId: string) {
      if (clientId !== client.client_id) throw new Error('not found');
      return client;
    },
  }, {
    oauthRuntimeUrl: 'https://auth-runtime.example.test',
  });
}

describe('GoTrue-compatible SSO authorize entrypoint', () => {
  it('validates redirect_uri by exact registered value', () => {
    expect(isRedirectUriAllowed(oauthClient, 'https://app.example.test/callback')).toBe(true);
    expect(isRedirectUriAllowed(oauthClient, 'https://app.example.test/callback/')).toBe(false);
    expect(isRedirectUriAllowed(oauthClient, 'https://evil.example.test/callback')).toBe(false);
    expect(isRedirectUriAllowed(oauthClient, 'https://app.example.test/callback#fragment')).toBe(false);
  });

  it('rejects unsafe client_id before calling SupaCloud', async () => {
    let calls = 0;
    const app = createSsoAuthorizeRoutes('/oauth/sso', {
      async getOAuthClient() {
        calls += 1;
        return oauthClient;
      },
    }, {
      oauthRuntimeUrl: 'https://auth-runtime.example.test',
    });

    const response = await app.handle(new Request(
      'http://localhost/oauth/sso/authorize?response_type=code&client_id=..%2F..%2Fconfig%2Fauth&redirect_uri=https%3A%2F%2Fapp.example.test%2Fcallback',
    ));

    expect(response.status).toBe(400);
    expect(calls).toBe(0);
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

  it('redirects valid requests to GoTrue without issuing tokens', async () => {
    const app = createTestApp();
    const response = await app.handle(new Request(
      'http://localhost/oauth/sso/authorize?response_type=code&client_id=app_123&redirect_uri=https%3A%2F%2Fapp.example.test%2Fcallback&scope=openid%20email&state=abc&prompt=none',
    ));

    expect(response.status).toBe(302);
    const location = response.headers.get('location') || '';
    expect(location).toStartWith('https://auth-runtime.example.test/auth/v1/oauth/authorize?');
    const redirect = new URL(location);
    expect(redirect.searchParams.get('client_id')).toBe('app_123');
    expect(redirect.searchParams.get('state')).toBe('abc');
    expect(redirect.searchParams.get('prompt')).toBe('none');
  });

  it('rejects unregistered redirect_uri before redirecting', async () => {
    const app = createTestApp();
    const response = await app.handle(new Request(
      'http://localhost/oauth/sso/authorize?response_type=code&client_id=app_123&redirect_uri=https%3A%2F%2Fevil.example.test%2Fcallback',
    ));

    expect(response.status).toBe(400);
    const payload = await response.json() as { error: string };
    expect(payload.error).toBe('invalid_request');
  });

  it('returns standard OAuth callback error for unsupported response_type', async () => {
    const app = createTestApp();
    const response = await app.handle(new Request(
      'http://localhost/oauth/sso/authorize?response_type=token&client_id=app_123&redirect_uri=https%3A%2F%2Fapp.example.test%2Fcallback&state=abc',
    ));

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') || '');
    expect(location.origin + location.pathname).toBe('https://app.example.test/callback');
    expect(location.searchParams.get('error')).toBe('unsupported_response_type');
    expect(location.searchParams.get('state')).toBe('abc');
  });
});
