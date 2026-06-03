// Hosted static pages: authorize UI, login redirect, admin console SPA.
// The auth-server owns these routes so Caddy only needs to reverse-proxy to :4010.

import { Elysia } from 'elysia';
import path from 'node:path';

const ADMIN_CONSOLE_BUILD = path.resolve(import.meta.dir, '../../../admin-console/build');
const PUBLIC_API_BASE_PLACEHOLDER = 'window.__SUPAOAUTH_PUBLIC_API_BASE__ = null;';

async function loadAuthorizeHtml(): Promise<string | null> {
  const candidates = [
    path.join(ADMIN_CONSOLE_BUILD, 'authorize.html'),
    path.resolve(import.meta.dir, '../../../admin-console/static/authorize.html'),
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

const authorizeHtmlCache: { html: string | null } = { html: null };
async function getAuthorizeHtml() {
  if (authorizeHtmlCache.html === null) {
    authorizeHtmlCache.html = await loadAuthorizeHtml();
  }
  return authorizeHtmlCache.html;
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
