import { Type as StrictType, decodeSchema as strictDecodeSchema } from '../../../shared/src/schema.js';
import { describe, expect, it } from 'bun:test';
import {
  buildGoTrueOAuthAuthorizeUrl,
  createSsoAuthorizeRoutes,
  isSafeRedirectUriSyntax,
  isSafeOAuthClientId,
  publicOriginFromRequest,
} from '../routes/sso-authorize.js';
import { operationTestPlugin } from './http-fixture.js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { buildHostedScript } from '../../../admin-console/src/hosted/build.js';

function createTestApp() {
  return operationTestPlugin(createSsoAuthorizeRoutes('/oauth/sso', {
    publicBaseUrl: '',
    trustProxyHeaders: false,
  }));
}

function requireRedirectLocation(response: Response): URL {
  const location = response.headers.get('location');
  if (location === null) throw new Error('Missing redirect location');
  return new URL(location);
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
    const app = operationTestPlugin(createSsoAuthorizeRoutes('/oauth/sso', {
      publicBaseUrl: '',
      trustProxyHeaders: false,
    }));

    const response = await app.handle(new Request(
      'http://localhost/oauth/sso/authorize?response_type=code&client_id=..%2F..%2Fconfig%2Fauth&redirect_uri=https%3A%2F%2Fapp.example.test%2Fcallback',
    ));

    expect(response.status).toBe(400);
    const payload = strictDecodeSchema(StrictType.Object({ "error": StrictType.String(), "error_description": StrictType.String() }), await response.json());
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
    const app = operationTestPlugin(createSsoAuthorizeRoutes('/oauth/sso', {
      publicBaseUrl: 'https://auth.example.test/',
      trustProxyHeaders: false,
    }));

    const response = await app.handle(new Request(
      'https://project-runtime.example.test/oauth/sso/authorize?response_type=code&client_id=app_123&redirect_uri=https%3A%2F%2Fapp.example.test%2Fcallback&scope=openid%20email',
    ));

    expect(response.status).toBe(302);
    const location = response.headers.get('location') || '';
    expect(location).toStartWith('https://auth.example.test/auth/v1/oauth/authorize?');
  });

  it('uses trusted forwarded host only when no custom auth domain is configured', async () => {
    const app = operationTestPlugin(createSsoAuthorizeRoutes('/oauth/sso', {
      publicBaseUrl: '',
      trustProxyHeaders: true,
    }));

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
    const payload = strictDecodeSchema(StrictType.Object({ "error": StrictType.String(), "error_description": StrictType.String() }), await response.json());
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
    const payload = strictDecodeSchema(StrictType.Object({ "error": StrictType.String() }), await response.json());
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

const interactiveRequest = (prompt = 'login') => new Request(
  `https://auth.example.test/oauth/sso/authorize?${new URLSearchParams({
    response_type: 'code', client_id: 'fa-client',
    redirect_uri: 'https://fa.example.test/auth/callback', scope: 'openid email',
    state: 'fresh-state', code_challenge: 'fresh-pkce-challenge', code_challenge_method: 'S256', prompt,
  })}`,
  { headers: { Cookie: 'old-session=private', Authorization: 'Bearer old-token' } },
);
const publicConfig = { publicBaseUrl: 'https://auth.example.test', trustProxyHeaders: false };

describe('explicit reauthentication after legacy sessions', () => {
  it('binds prompt=login to the new GoTrue authorization without forwarding old credentials', async () => {
    const requests: Array<{ url: URL; init: RequestInit }> = [];
    const app = operationTestPlugin(createSsoAuthorizeRoutes('/oauth/sso', publicConfig, async (url, init) => {
      requests.push({ url, init });
      return new Response(null, { status: 302, headers: { location: '/oauth/authorize?authorization_id=fresh-id' } });
    }));
    const response = await app.handle(interactiveRequest());
    expect(response.status).toBe(302);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const destination = requireRedirectLocation(response);
    expect(destination.origin).toBe(publicConfig.publicBaseUrl);
    expect(destination.searchParams.get('authorization_id')).toBe('fresh-id');
    expect(destination.searchParams.get('prompt')).toBe('login');
    expect(requests).toHaveLength(1);
    const forwarded = requests[0];
    if (!forwarded) throw new Error('Expected one outbound authorization request');
    expect(forwarded.url.pathname).toBe('/auth/v1/oauth/authorize');
    expect(forwarded.url.searchParams.get('state')).toBe('fresh-state');
    expect(forwarded.url.searchParams.get('code_challenge')).toBe('fresh-pkce-challenge');
    expect(forwarded.init.redirect).toBe('manual');
    expect(forwarded.init.credentials).toBe('omit');
    expect(forwarded.init.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(forwarded.init.headers).has('cookie')).toBe(false);
    expect(new Headers(forwarded.init.headers).has('authorization')).toBe(false);

    // 执行真实托管页初始化函数，确认最终地址触发退出，而非读取并复用旧会话。
    const source = ts.createSourceFile('authorize.ts', readFileSync(
      new URL('../../../admin-console/src/hosted/authorize.ts', import.meta.url), 'utf8',
    ), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const init = source.statements.find((statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === 'init');
    if (!init) throw new Error('Missing hosted login initialization');
    const code = ts.transpileModule(init.getText(source), {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    let signouts = 0, reads = 0;
    await runInNewContext(`${code}; init()`, {
      forceLogin: destination.searchParams.get('prompt') === 'login',
      authorizationId: destination.searchParams.get('authorization_id'),
      currentLocale: 'zh-CN', loadPhrases: async () => {}, applyLocale() {}, loadExperience: async () => {},
      hostedAuth: {
        signOut: async (options: { scope: string }) => { expect(options.scope).toBe('local'); signouts++; return { error: null }; },
        getSession: async () => { reads++; throw new Error('Must not restore old session'); },
        consumeMagicLinkSessionFromUrl: async () => { throw new Error('Must not reuse a login URL'); },
      },
    });
    expect(signouts).toBe(1);
    expect(reads).toBe(0);
  });

  it('leaves prompt=none on the browser GoTrue path without adding a server request', async () => {
    const app = operationTestPlugin(createSsoAuthorizeRoutes('/oauth/sso', publicConfig, async () => {
      throw new Error('Silent authentication must not make this request');
    }));
    const response = await app.handle(interactiveRequest('none'));
    expect(response.status).toBe(302);
    expect(requireRedirectLocation(response).pathname).toBe('/auth/v1/oauth/authorize');
  });

  it('rejects incompatible prompts and unconfigured outbound origins before fetching', async () => {
    for (const [config, prompt, status] of [
      [publicConfig, 'login none', 400],
      [{ publicBaseUrl: '', trustProxyHeaders: false }, 'login', 503],
    ] as const) {
      const app = operationTestPlugin(createSsoAuthorizeRoutes('/oauth/sso', config, async () => {
        throw new Error('Unexpected outbound request');
      }));
      const response = await app.handle(interactiveRequest(prompt));
      expect(response.status).toBe(status);
      expect(response.headers.get('location')).toBeNull();
      expect(await response.json()).toMatchObject(status === 400
        ? { error: 'invalid_request' }
        : { success: false, error: { code: 'interactive_auth_origin_unavailable' } });
    }
  });

  for (const location of [
    'https://other.example.test/oauth/authorize?authorization_id=one',
    'https://user:password@auth.example.test/oauth/authorize?authorization_id=one',
    '/auth/callback?code=private', '/oauth/authorize', '/oauth/authorize?authorization_id=',
    '/oauth/authorize?authorization_id=one&authorization_id=two',
    '/oauth/authorize?authorization_id=one#fragment',
    '/oauth/authorize?authorization_id=one&access_token=private',
  ]) {
    it(`rejects unsafe or malformed upstream redirect ${location}`, async () => {
      const app = operationTestPlugin(createSsoAuthorizeRoutes('/oauth/sso', publicConfig, async () =>
        new Response(null, { status: 302, headers: { location } })));
      const response = await app.handle(interactiveRequest());
      expect(response.status).toBe(502);
      expect(response.headers.get('location')).toBeNull();
      const body: unknown = await response.json();
      expect(body).toMatchObject({ success: false, error: { code: 'interactive_auth_unavailable' } });
      expect(JSON.stringify(body)).not.toContain('private');
    });
  }

  for (const status of [400, 401, 500, 200]) {
    it(`does not silently restart SSO after upstream ${status}`, async () => {
      let calls = 0;
      const app = operationTestPlugin(createSsoAuthorizeRoutes('/oauth/sso', publicConfig, async () => {
        calls++;
        return new Response('private failure detail', { status });
      }));
      const response = await app.handle(interactiveRequest());
      expect(response.status).toBe(status === 400 ? 400 : 502);
      expect(response.headers.get('location')).toBeNull();
      const body: unknown = await response.json();
      expect(body).toMatchObject(status === 400
        ? { error: 'invalid_request' }
        : { success: false, error: { code: 'interactive_auth_unavailable' } });
      expect(JSON.stringify(body)).not.toContain('private');
      expect(calls).toBe(1);
    });
  }

  it('does not retry or downgrade a timed-out authorization creation', async () => {
    let calls = 0;
    const app = operationTestPlugin(createSsoAuthorizeRoutes('/oauth/sso', publicConfig, async () => {
      calls++;
      throw new DOMException('private timeout', 'TimeoutError');
    }));
    const response = await app.handle(interactiveRequest());
    expect(response.status).toBe(502);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.json()).toMatchObject({ success: false, error: { code: 'interactive_auth_unavailable' } });
    expect(calls).toBe(1);
  });

  it('hosted logout redirects only after both revocation and storage cleanup succeed', async () => {
    const script = await buildHostedScript('logout');
    for (const failure of ['none', 'network', 'storage', 'storage-getter', 'no-client'] as const) {
      const redirects: string[] = [];
      const status = { namespaceURI: 'http://www.w3.org/1999/xhtml', textContent: '', className: '' };
      const persisted = new Map([['supaoauth.hosted.auth.session', 'old-central-session']]);
      const storage = {
        removeItem: (key: string) => { if (failure === 'storage') throw new Error('Storage blocked'); persisted.delete(key); },
        getItem: (key: string) => persisted.get(key) ?? null,
      };
      const window = {
        get localStorage() { if (failure === 'storage-getter') throw new Error('Storage unavailable'); return storage; },
        sessionStorage: storage,
        location: { replace: (url: string) => { redirects.push(url); } },
        ...(failure === 'no-client' ? {} : { SupaOAuthHostedAuth: {
          signOut: async () => {
            if (failure === 'network') throw new Error('Logout unavailable');
            return { error: null };
          },
        } }),
      };
      runInNewContext(script, {
        window, document: { querySelector: () => status, querySelectorAll: () => [status] },
      });
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      expect(redirects.length).toBe(failure === 'none' ? 1 : 0);
      if (failure !== 'none') expect(status.className).toBe('error');
    }
  });
});
