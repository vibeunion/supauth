import { describe, expect, test } from 'bun:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { getConfig, loadConfig } from '../config/index.js';
import {
  LOGOUT_PAGE_HEADERS,
  resolvePostLogoutRedirect,
  type LogoutValidationDependencies,
} from '../routes/logout-page.js';

async function signedIdToken(clientId: string) {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'logout-key';
  const token = await new SignJWT({ azp: clientId })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .setIssuer('https://auth.example.test/auth/v1')
    .setAudience(clientId)
    .setSubject('user-one')
    .setExpirationTime('5m')
    .sign(privateKey);
  return { token, jwks: { keys: [jwk] } };
}

describe('hosted logout redirect validation', () => {
  test('returns an exactly registered redirect after verifying the ID token', async () => {
    const clientId = 'business-app';
    const { token, jwks } = await signedIdToken(clientId);
    const dependencies: LogoutValidationDependencies = {
      discovery: async () => ({ issuer: 'https://auth.example.test/auth/v1' }),
      jwks: async () => jwks,
      oauthClient: async () => ({
        client_id: clientId,
        redirect_uris: ['https://app.example.test/login'],
      }),
    };
    const redirect = await resolvePostLogoutRedirect(
      new Request('https://auth.example.test/logout'),
      {
        client_id: clientId,
        id_token_hint: token,
        post_logout_redirect_uri: 'https://app.example.test/login',
        state: 'logout-state',
      },
      dependencies,
    );
    expect(redirect).toBe('https://app.example.test/login?state=logout-state');
  });

  test('fails closed for an unregistered redirect', async () => {
    const requestUrl = 'https://auth.example.test/logout';
    const redirect = await resolvePostLogoutRedirect(
      new Request(requestUrl),
      {
        client_id: 'business-app',
        id_token_hint: 'invalid',
        post_logout_redirect_uri: 'https://evil.example.test/login',
      },
      {
        discovery: async () => ({ issuer: 'https://auth.example.test/auth/v1' }),
        jwks: async () => ({ keys: [] }),
        oauthClient: async () => ({ redirect_uris: ['https://app.example.test/login'] }),
      },
    );
    expect(redirect).toBe(new URL(
      '/login?logged_out=1',
      getConfig().publicBaseUrl || requestUrl,
    ).toString());
  });

  test('uses the configured public origin instead of the request host', async () => {
    const originalPublicUrl = process.env.SUPAUTH_PUBLIC_URL;
    process.env.SUPAUTH_PUBLIC_URL = 'https://configured-auth.example.test';
    loadConfig();
    const requestUrl = 'https://untrusted-forwarded-host.example.test/logout';
    try {
      const redirect = await resolvePostLogoutRedirect(new Request(requestUrl), {});
      expect(redirect).toBe('https://configured-auth.example.test/login?logged_out=1');
    } finally {
      if (originalPublicUrl === undefined) delete process.env.SUPAUTH_PUBLIC_URL;
      else process.env.SUPAUTH_PUBLIC_URL = originalPublicUrl;
      loadConfig();
    }
  });

  test('exports hardened browser response headers', () => {
    expect(LOGOUT_PAGE_HEADERS['cache-control']).toBe('no-store');
    expect(LOGOUT_PAGE_HEADERS['referrer-policy']).toBe('no-referrer');
    expect(LOGOUT_PAGE_HEADERS['content-security-policy']).toContain("connect-src 'self'");
    expect(LOGOUT_PAGE_HEADERS['content-security-policy']).toContain("frame-ancestors 'none'");
  });
});
