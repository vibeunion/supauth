import { afterAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { isOAuthAuthorizationNotFound } from '../packages/auth-server/src/utils/oauth-authorization-failure.js';
import { authorizationHtml, patchLiveSource } from '../scripts/issue-3162-scoped-hotfix.js';
import { renderHostedPage } from '../packages/admin-console/src/hosted/build.js';
import { chromium } from 'playwright';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';

process.env['OAUTH_RUNTIME_URL'] = 'https://runtime.example.test';
process.env['OAUTH_RUNTIME_INTERNAL_URL'] = 'https://internal.example.test';
process.env['SUPAUTH_PUBLIC_URL'] = 'https://auth.example.test';
const { loadConfig } = await import('../packages/auth-server/src/config/index.js');
loadConfig();
const { publicOAuthRoutes } = await import('../packages/auth-server/src/routes/sign-in-experience.js');
const originalFetch = globalThis.fetch;
const liveSourceDirectory = process.env['ISSUE_3162_SOURCE_DIR'];
afterAll(() => { globalThis.fetch = originalFetch; });

describe('FA #3162 OAuth authorization recovery', () => {
  test('only classifies the GoTrue authorization error, not an arbitrary 404', () => {
    for (const payload of [null, {}, [], { error_code: 'not_found' }, { msg: 'authorization not found' }]) {
      expect(isOAuthAuthorizationNotFound(404, payload)).toBe(false);
    }
    expect(isOAuthAuthorizationNotFound(404, { error_code: 'oauth_authorization_not_found' })).toBe(true);
    expect(isOAuthAuthorizationNotFound(404, { code: 'oauth_authorization_not_found' })).toBe(true);
    expect(isOAuthAuthorizationNotFound(500, { error_code: 'oauth_authorization_not_found' })).toBe(false);
  });

  for (const consent of [false, true]) {
    test(`does not replay a missing authorization on a second route (consent=${consent})`, async () => {
      const urls: string[] = [];
      globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
        urls.push(input instanceof Request ? input.url : String(input));
        return Response.json({
          code: 404, error_code: 'oauth_authorization_not_found', msg: 'private upstream detail',
        }, { status: 404 });
      }, { preconnect() {} });
      const response = await new Elysia().use(publicOAuthRoutes).handle(new Request(
        `https://auth.example.test/v1/public/oauth/authorizations/missing${consent ? '/consent' : ''}`,
        {
          method: consent ? 'POST' : 'GET',
          headers: { Authorization: 'Bearer synthetic-token', 'Content-Type': 'application/json' },
          ...(consent ? { body: JSON.stringify({ action: 'approve' }) } : {}),
        },
      ));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: 'oauth_authorization_not_found',
        error_description: 'This sign-in request is no longer available. Please return to the application and sign in again.',
      });
      expect(urls).toEqual(['https://internal.example.test/oauth/authorizations/missing']);
    });
  }

  test('still falls back for a non-JSON route-level 404', async () => {
    const urls: string[] = [];
    globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
      urls.push(input instanceof Request ? input.url : String(input));
      return urls.length === 1
        ? new Response('Not Found', { status: 404 })
        : Response.json({ redirect_url: 'https://client.example.test/callback?code=synthetic' });
    }, { preconnect() {} });
    const response = await new Elysia().use(publicOAuthRoutes).handle(new Request(
      'https://auth.example.test/v1/public/oauth/authorizations/fresh',
      { headers: { Authorization: 'Bearer synthetic-token' } },
    ));
    expect(response.status).toBe(200);
    expect(urls).toEqual([
      'https://internal.example.test/oauth/authorizations/fresh',
      'https://internal.example.test/auth/v1/oauth/authorizations/fresh',
    ]);
  });

  for (const failure of [
    { label: 'timeout', error: new DOMException('private upstream timeout', 'TimeoutError'), status: 504, code: 'runtime_timeout' },
    { label: 'connection loss', error: new TypeError('private upstream connection terminated'), status: 502, code: 'runtime_unavailable' },
  ] as const) {
    test(`falls back to auth/v1 when the raw internal GET 404 body fails with ${failure.label}`, async () => {
      const urls: string[] = [];
      const payload = { redirect_url: 'https://client.example.test/callback?code=synthetic' };
      globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
        urls.push(input instanceof Request ? input.url : String(input));
        return urls.length === 1
          ? new Response(new ReadableStream<Uint8Array>({
            start(controller) { controller.error(failure.error); },
          }), { status: 404 })
          : Response.json(payload);
      }, { preconnect() {} });
      const response = await new Elysia().use(publicOAuthRoutes).handle(new Request(
        'https://auth.example.test/v1/public/oauth/authorizations/fresh',
        { headers: { Authorization: 'Bearer synthetic-token' } },
      ));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(payload);
      expect(urls).toEqual([
        'https://internal.example.test/oauth/authorizations/fresh',
        'https://internal.example.test/auth/v1/oauth/authorizations/fresh',
      ]);
    });

    for (const upstreamStatus of [200, 500]) {
      test(`preserves ${failure.status} without retry when a non-404 (${upstreamStatus}) body fails with ${failure.label}`, async () => {
        const urls: string[] = [];
        globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
          urls.push(input instanceof Request ? input.url : String(input));
          return new Response(new ReadableStream<Uint8Array>({
            start(controller) { controller.error(failure.error); },
          }), { status: upstreamStatus });
        }, { preconnect() {} });
        const response = await new Elysia().use(publicOAuthRoutes).handle(new Request(
          'https://auth.example.test/v1/public/oauth/authorizations/fresh',
          { headers: { Authorization: 'Bearer synthetic-token' } },
        ));
        expect(response.status).toBe(failure.status);
        expect(await response.json()).toEqual({
          error: failure.code,
          error_description: failure.status === 504
            ? 'Authentication runtime timed out.'
            : 'Authentication runtime is unavailable.',
        });
        expect(urls).toEqual(['https://internal.example.test/oauth/authorizations/fresh']);
      });
    }
  }

  test('scoped artifact refuses source drift', () => {
    expect(() => patchLiveSource('unknown source')).toThrow('approved live version');
  });

  test.skipIf(!liveSourceDirectory)('scoped artifact preserves live backend not-found semantics', async () => {
    for (const environment of ['test', 'production']) {
      const source = patchLiveSource(await Bun.file(`${liveSourceDirectory}/issue-3162-${environment}-before.json`).text());
      const file = ts.createSourceFile('live.js', source, ts.ScriptTarget.Latest, true);
      const names = new Set(['fetchGoTrueJson', 'isOAuthAuthorizationNotFound', 'goTrueOAuthPayload']);
      const functions = file.statements
        .filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && !!node.name && names.has(node.name.text))
        .map(node => node.getText(file)).join('\n');
      const urls: string[] = [];
      const result: unknown = await runInNewContext(`(async () => {
        ${functions}
        const response = await fetchGoTrueJson('/oauth/authorizations/missing');
        const set = {};
        return { body: goTrueOAuthPayload(response, set, {}), status: set.status };
      })()`, {
        config2: { oauthRuntimeInternalUrl: 'https://internal.test', oauthRuntimeUrl: 'https://runtime.test', publicBaseUrl: 'https://public.test' },
        goTrueApiBaseCandidates: () => ['https://internal.test'],
        buildRawGoTrueApiUrl: (base: string, path: string) => base + path,
        buildGoTrueApiUrl: (base: string, path: string) => base + '/auth/v1' + path,
        readJsonResponse: (response: Response) => response.json(),
        AbortSignal,
        fetch: async (url: string) => {
          urls.push(url);
          return Response.json({ error_code: 'oauth_authorization_not_found' }, { status: 404 });
        },
      });
      expect(result).toMatchObject({ status: 404, body: { error: 'oauth_authorization_not_found' } });
      expect(urls).toEqual(['https://internal.test/oauth/authorizations/missing']);
      new Bun.Transpiler({ loader: 'js' }).scan(source);
    }
  });

  test.skipIf(process.env['RUN_ISSUE_3162_BROWSER'] !== '1')('current and deployed-page artifacts stop stale submissions and preserve fresh consent', async () => {
    const executablePath = process.env['PLAYWRIGHT_EXECUTABLE_PATH'];
    const browser = await chromium.launch({
      headless: true,
      ...(executablePath !== undefined ? { executablePath } : {}),
    });
    try {
      const pages = [
        { label: 'current', html: await renderHostedPage('authorize') },
        ...await Promise.all((liveSourceDirectory ? ['test', 'production'] : []).map(async label => ({
          label,
          html: authorizationHtml(patchLiveSource(await Bun.file(`${liveSourceDirectory}/issue-3162-${label}-before.json`).text())),
        }))),
      ];
      for (const { label, html } of pages) {
        for (const mode of ['missing', 'fresh', 'generic-404'] as const) {
          const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
          const errors: string[] = [];
          let lookups = 0;
          page.on('pageerror', error => errors.push(error.message));
          await page.addInitScript(() => {
            Object.defineProperty(window, 'SupaOAuthHostedAuth', { value: {
              consumeMagicLinkSessionFromUrl: async () => null,
              getSession: async () => ({ data: { session: { access_token: 'synthetic-token' } }, error: null }),
              signInWithPassword: async () => { throw new Error('Stale page must not submit credentials'); },
            }, configurable: true });
          });
          await page.route('**/*', async route => {
            const path = new URL(route.request().url()).pathname;
            if (path === '/prior') return route.fulfill({ contentType: 'text/html', body: '<p>Application</p>' });
            if (path === '/oauth/authorize') return route.fulfill({ contentType: 'text/html', body: html });
            if (path.includes('/oauth/authorizations/')) {
              lookups++;
              return route.fulfill({
                status: mode === 'fresh' ? 200 : 404,
                json: mode === 'fresh'
                  ? { authorization_id: 'fixture', client: { id: 'client', name: 'FA' }, user: { id: 'user' }, scope: 'openid' }
                  : { error: mode === 'missing' ? 'oauth_authorization_not_found' : 'upstream_not_found' },
              });
            }
            if (path.includes('/phrases/')) return route.fulfill({ json: { language_tag: 'zh-CN', phrases: {} } });
            if (path.includes('/sign-in-experience/')) return route.fulfill({ json: {
              branding: {}, connectors: [], sign_up: { enabled: false },
              password_policy: { min_length: 8, require_uppercase: false, require_lowercase: false, require_numbers: false, require_symbols: false },
            } });
            return route.fulfill({ contentType: 'application/javascript', body: '' });
          });
          await page.goto('https://auth.example.test/prior');
          await page.goto('https://auth.example.test/oauth/authorize?authorization_id=fixture');
          if (mode === 'fresh') {
            await page.locator('#consent-panel').waitFor({ state: 'visible' });
            expect(await page.locator('#consent-approve').isEnabled()).toBe(true);
          } else {
            await page.waitForFunction(() => !!document.getElementById('message')?.textContent);
            expect(await page.locator('#submit').isDisabled()).toBe(mode === 'missing');
            if (mode === 'missing') {
              expect(await page.locator('#message').textContent()).toContain('本次登录请求已失效');
              await page.locator('#login-form').dispatchEvent('submit');
              expect(lookups).toBe(1);
              expect(await page.locator('#password').inputValue()).toBe('');
              const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
              expect(overflow).toBe(false);
              await page.screenshot({ path: `/tmp/issue-3162-${label}-missing.png` });
              await page.setViewportSize({ width: 1920, height: 1080 });
              expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
              await page.screenshot({ path: `/tmp/issue-3162-${label}-missing-wide.png` });
              await page.locator('#authorization-back').click();
              await page.waitForURL('https://auth.example.test/prior');
            }
          }
          expect(errors).toEqual([]);
          expect(lookups).toBe(1);
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
  }, 60_000);
});
