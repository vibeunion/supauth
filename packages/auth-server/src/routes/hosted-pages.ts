// Hosted static pages: authorize UI, login redirect, admin console SPA.
// The auth-server owns these routes so Caddy only needs to reverse-proxy to :4010.
// Supports Custom UI Assets: if custom-ui/index.html exists, it replaces the default page.

import { Elysia } from 'elysia';
import path from 'node:path';

// Resolve project root: import.meta.dir works in dev, but in a Bun bundle it points to dist/.
// Fall back to process.cwd() when the relative path doesn't yield a valid directory.
function resolveProjectRoot(): string {
  const fromMeta = path.resolve(import.meta.dir, '../../..');
  if (Bun.file(path.join(fromMeta, 'packages/admin-console/build/authorize.html')).size) {
    return fromMeta;
  }
  return process.cwd();
}
const PROJECT_ROOT = resolveProjectRoot();
const ADMIN_CONSOLE_BUILD = path.join(PROJECT_ROOT, 'packages/admin-console/build');
const CUSTOM_UI_DIR = path.join(PROJECT_ROOT, 'packages/auth-server/custom-ui');
const PUBLIC_API_BASE_PLACEHOLDER = 'window.__SUPAOAUTH_PUBLIC_API_BASE__ = null;';

async function loadAuthorizeHtml(): Promise<string | null> {
  // Custom UI takes priority
  const customIndex = path.join(CUSTOM_UI_DIR, 'index.html');
  const customFile = Bun.file(customIndex);
  if (await customFile.exists()) {
    const html = await customFile.text();
    return html;
  }

  const candidates = [
    path.join(ADMIN_CONSOLE_BUILD, 'authorize.html'),
    path.join(PROJECT_ROOT, 'packages/admin-console/static/authorize.html'),
  ];
  for (const p of candidates) {
    const f = Bun.file(p);
    if (await f.exists()) return f.text();
  }
  return null;
}

function renderAuthorizeHtml(html: string, requestUrl: string) {
  const publicApiBase = new URL('/v1/public', requestUrl).toString().replace(/\/$/, '');
  return html.replace(
    PUBLIC_API_BASE_PLACEHOLDER,
    `window.__SUPAOAUTH_PUBLIC_API_BASE__ = ${JSON.stringify(publicApiBase)};`,
  );
}

// Cache default HTML only (custom UI is always re-read for development)
const defaultHtmlCache: { html: string | null; checkedAt: number } = { html: null, checkedAt: 0 };
const CACHE_TTL = 60_000; // 60 seconds

async function getAuthorizeHtml() {
  // Check custom UI first (always fresh)
  const customIndex = path.join(CUSTOM_UI_DIR, 'index.html');
  const customFile = Bun.file(customIndex);
  if (await customFile.exists()) {
    return customFile.text();
  }

  // Cache default HTML
  const now = Date.now();
  if (defaultHtmlCache.html !== null && now - defaultHtmlCache.checkedAt < CACHE_TTL) {
    return defaultHtmlCache.html;
  }
  defaultHtmlCache.html = await loadAuthorizeHtml();
  defaultHtmlCache.checkedAt = now;
  return defaultHtmlCache.html;
}

function serveStaticFile(filePath: string) {
  const f = Bun.file(filePath);
  if (!f.size) return null;
  return new Response(f);
}

export const hostedPageRoutes = new Elysia()
  // Hosted OAuth authorize page
  .get('/oauth/authorize', async ({ request, set }) => {
    const html = await getAuthorizeHtml();
    if (!html) {
      set.status = 404;
      return { error: 'authorize_page_missing' };
    }
    set.headers['content-type'] = 'text/html; charset=utf-8';
    return renderAuthorizeHtml(html, request.url);
  }, {
    detail: { summary: 'Serve hosted OAuth authorize page', tags: ['Public', 'Consent'] },
  })

  // Login page and root redirect to authorize
  .get('/login.html', async ({ request, set }) => {
    const html = await getAuthorizeHtml();
    if (!html) {
      set.status = 404;
      return { error: 'authorize_page_missing' };
    }
    set.headers['content-type'] = 'text/html; charset=utf-8';
    return renderAuthorizeHtml(html, request.url);
  }, {
    detail: { summary: 'Serve hosted login page (alias for authorize)', tags: ['Public'] },
  })

  .get('/', async ({ request, set }) => {
    const html = await getAuthorizeHtml();
    if (!html) {
      set.status = 404;
      return { error: 'authorize_page_missing' };
    }
    set.headers['content-type'] = 'text/html; charset=utf-8';
    return renderAuthorizeHtml(html, request.url);
  }, {
    detail: { summary: 'Serve hosted landing page (alias for authorize)', tags: ['Public'] },
  })

  // Custom UI static assets: /custom-ui/*
  .get('/custom-ui/*', async ({ params }) => {
    const sub = (params as Record<string, string>)['*'] || '';
    if (sub.includes('..')) return new Response('Forbidden', { status: 403 });
    const filePath = path.join(CUSTOM_UI_DIR, sub);
    const resp = serveStaticFile(filePath);
    if (!resp) return new Response('Not Found', { status: 404 });
    return resp;
  })

  // Admin console SPA static assets: /_app/*
  .get('/_app/*', ({ params }) => {
    const sub = (params as Record<string, string>)['*'] || '';
    const filePath = path.join(ADMIN_CONSOLE_BUILD, '_app', sub);
    const resp = serveStaticFile(filePath);
    if (!resp) return new Response('Not Found', { status: 404 });
    return resp;
  })

  // Admin console SPA pages: /admin/*
  .get('/admin/*', ({ params }) => {
    const sub = (params as Record<string, string>)['*'] || '';
    const filePath = path.join(ADMIN_CONSOLE_BUILD, sub || 'index.html');
    const resp = serveStaticFile(filePath);
    if (!resp) return new Response('Not Found', { status: 404 });
    return resp;
  })

  // robots.txt
  .get('/robots.txt', () => {
    const f = Bun.file(path.join(ADMIN_CONSOLE_BUILD, 'robots.txt'));
    if (!f.size) return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } });
    return new Response(f);
  });
