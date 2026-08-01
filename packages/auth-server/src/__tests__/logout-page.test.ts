import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
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

const originalNodeEnv = process.env.NODE_ENV;

function clientOnlyDependencies(
  clientId: string,
  registeredRedirects: string[],
): LogoutValidationDependencies {
  return {
    discovery: async () => { throw new Error('discovery should not be requested'); },
    jwks: async () => { throw new Error('JWKS should not be requested'); },
    oauthClient: async () => ({
      client_id: clientId,
      post_logout_redirect_uris: registeredRedirects,
    }),
  };
}

async function clientOnlyRedirect(requestedRedirect: string, state = '') {
  const clientId = 'business-app';
  return resolvePostLogoutRedirect(
    new Request('https://auth.example.test/logout'),
    {
      client_id: clientId,
      post_logout_redirect_uri: requestedRedirect,
      state,
    },
    clientOnlyDependencies(clientId, [requestedRedirect]),
  );
}

function expectedFallback() {
  return new URL(
    '/login?logged_out=1',
    getConfig().publicBaseUrl || 'https://auth.example.test/logout',
  ).toString();
}

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  loadConfig();
});

afterAll(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  loadConfig();
});

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

  test('returns an exactly registered redirect for client-only logout', async () => {
    const redirect = await resolvePostLogoutRedirect(
      new Request('https://auth.example.test/logout'),
      {
        client_id: 'business-app',
        post_logout_redirect_uri: 'https://app.example.test/login',
        state: 'logout-state',
      },
      {
        discovery: async () => { throw new Error('discovery should not be requested'); },
        jwks: async () => { throw new Error('JWKS should not be requested'); },
        oauthClient: async () => ({
          client_id: 'business-app',
          post_logout_redirect_uris: ['https://app.example.test/login'],
        }),
      },
    );
    expect(redirect).toBe('https://app.example.test/login?state=logout-state');
  });

  for (const [label, redirectUri] of [
    ['non-loopback HTTP', 'http://example.com/logout'],
    ['URL credentials', 'https://user:password@app.example.test/logout'],
    ['empty URL username', 'https://@app.example.test/logout'],
    ['empty URL username and password', 'https://:@app.example.test/logout'],
    ['leading-space empty URL username', ' https://@app.example.test/logout'],
    ['tab-normalized empty URL username', 'ht\ttps://@app.example.test/logout'],
    ['backslash empty URL username', 'https:\\\\@app.example.test/logout'],
    ['fragment', 'https://app.example.test/logout#session'],
    ['empty fragment', 'https://app.example.test/logout#'],
    ['protocol-relative URL', '//app.example.test/logout'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,logout'],
    ['non-HTTP scheme', 'ftp://app.example.test/logout'],
  ] as const) {
    test(`rejects an exactly registered ${label} redirect`, async () => {
      expect(await clientOnlyRedirect(redirectUri)).toBe(expectedFallback());
    });
  }

  test('rejects raw empty userinfo before looking up the OAuth client', async () => {
    let lookups = 0;
    for (const postLogoutRedirectUri of [
      'https://@app.example.test/logout',
      'https://:@app.example.test/logout',
      ' https://@app.example.test/logout',
      'ht\ttps://@app.example.test/logout',
      'https:\\\\@app.example.test/logout',
    ]) {
      const redirect = await resolvePostLogoutRedirect(
        new Request('https://auth.example.test/logout'),
        {
          client_id: 'business-app',
          post_logout_redirect_uri: postLogoutRedirectUri,
        },
        {
          discovery: async () => { throw new Error('discovery should not be requested'); },
          jwks: async () => { throw new Error('JWKS should not be requested'); },
          oauthClient: async () => {
            lookups += 1;
            return {
              client_id: 'business-app',
              post_logout_redirect_uris: [postLogoutRedirectUri],
            };
          },
        },
      );
      expect(redirect).toBe(expectedFallback());
    }
    expect(lookups).toBe(0);
  });

  test('allows at-signs outside the raw authority', async () => {
    const redirectUri = 'https://app.example.test/users/@me?next=@logout';
    expect(await clientOnlyRedirect(redirectUri)).toBe(redirectUri);
  });

  for (const redirectUri of [
    'http://localhost:3000/logout',
    'http://127.0.0.1:3000/logout',
    'http://[::1]:3000/logout',
  ]) {
    test(`allows test-environment loopback redirect ${redirectUri}`, async () => {
      expect(await clientOnlyRedirect(redirectUri, 'logout-state'))
        .toBe(`${redirectUri}?state=logout-state`);
    });

    test(`rejects production loopback redirect ${redirectUri}`, async () => {
      process.env.NODE_ENV = 'production';
      loadConfig();
      expect(await clientOnlyRedirect(redirectUri)).toBe(expectedFallback());
    });
  }

  for (const redirectUri of [
    'http://localhost.example.test/logout',
    'http://127.0.0.2/logout',
    'http://[::2]/logout',
  ]) {
    test(`rejects non-loopback HTTP redirect ${redirectUri}`, async () => {
      expect(await clientOnlyRedirect(redirectUri)).toBe(expectedFallback());
    });
  }

  for (const redirectUri of [
    'http://user:password@localhost/logout',
    'http://localhost./logout',
    'http://LOCALHOST/logout',
  ]) {
    test(`rejects non-literal loopback HTTP authority ${redirectUri}`, async () => {
      expect(await clientOnlyRedirect(redirectUri)).toBe(expectedFallback());
    });
  }

  for (const redirectUri of [
    'http://127.1/logout',
    'http://127.0.1/logout',
    'http://2130706433/logout',
    'http://0x7f000001/logout',
    'http://0177.0.0.1/logout',
    'http://%31%32%37.0.0.1/logout',
    'http://%6c%6f%63%61%6c%68%6f%73%74/logout',
    'http://[0:0:0:0:0:0:0:1]/logout',
  ]) {
    test(`rejects disguised loopback HTTP redirect ${redirectUri}`, async () => {
      expect(await clientOnlyRedirect(redirectUri)).toBe(expectedFallback());
    });
  }

  test('allows an exact loopback authority with path, query, and uppercase HTTP scheme', async () => {
    expect(await clientOnlyRedirect(
      'HTTP://localhost:3000/logout/complete?source=account',
      'logout-state',
    )).toBe('http://localhost:3000/logout/complete?source=account&state=logout-state');
  });

  test('preserves an exact HTTPS redirect and state in production', async () => {
    process.env.NODE_ENV = 'production';
    loadConfig();
    expect(await clientOnlyRedirect(
      'https://app.example.test/logout?source=account',
      'logout-state',
    )).toBe('https://app.example.test/logout?source=account&state=logout-state');
  });

  test('rejects loopback HTTP in non-local environments', async () => {
    process.env.NODE_ENV = 'staging';
    loadConfig();
    expect(await clientOnlyRedirect('http://localhost:3000/logout')).toBe(expectedFallback());
  });

  test('allows loopback HTTP in development', async () => {
    process.env.NODE_ENV = 'development';
    loadConfig();
    expect(await clientOnlyRedirect('http://localhost:3000/logout'))
      .toBe('http://localhost:3000/logout');
  });

  test('still fails closed when a supplied ID token is invalid', async () => {
    const requestUrl = 'https://auth.example.test/logout';
    const redirect = await resolvePostLogoutRedirect(
      new Request(requestUrl),
      {
        client_id: 'business-app',
        id_token_hint: 'invalid',
        post_logout_redirect_uri: 'https://app.example.test/login',
      },
      {
        discovery: async () => ({ issuer: 'https://auth.example.test/auth/v1' }),
        jwks: async () => ({ keys: [] }),
        oauthClient: async () => ({
          client_id: 'business-app',
          post_logout_redirect_uris: ['https://app.example.test/login'],
        }),
      },
    );
    expect(redirect).toBe(new URL(
      '/login?logged_out=1',
      getConfig().publicBaseUrl || requestUrl,
    ).toString());
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
