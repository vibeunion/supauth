// Hosted static pages: authorize UI, login redirect, admin console SPA.
// The auth-server owns these routes so Caddy only needs to reverse-proxy to :4010.
// Supports Custom UI Assets: if custom-ui/index.html exists, it replaces the default page.

import { Elysia } from 'elysia';
import path from 'node:path';

function uniquePaths(paths: string[]) {
  return [...new Set(paths.map(candidate => path.normalize(candidate)))];
}

export function resolveHostedPagePaths(importMetaDir = import.meta.dir, cwd = process.cwd()) {
  const adminConsoleBuildDirs = uniquePaths([
    path.resolve(importMetaDir, '../../../admin-console/build'),
    path.resolve(importMetaDir, '../../admin-console/build'),
    path.resolve(cwd, '../admin-console/build'),
    path.resolve(cwd, 'packages/admin-console/build'),
  ]);

  const authorizeHtmlCandidates = uniquePaths([
    ...adminConsoleBuildDirs.map(dir => path.join(dir, 'authorize.html')),
    path.resolve(importMetaDir, '../../../admin-console/static/authorize.html'),
    path.resolve(importMetaDir, '../../admin-console/static/authorize.html'),
    path.resolve(cwd, '../admin-console/static/authorize.html'),
    path.resolve(cwd, 'packages/admin-console/static/authorize.html'),
  ]);

  const customUiDirs = uniquePaths([
    path.resolve(importMetaDir, '../../custom-ui'),
    path.resolve(importMetaDir, '../custom-ui'),
    path.resolve(cwd, 'custom-ui'),
    path.resolve(cwd, 'packages/auth-server/custom-ui'),
  ]);

  return {
    adminConsoleBuildDirs,
    authorizeHtmlCandidates,
    customUiDirs,
  };
}

const hostedPagePaths = resolveHostedPagePaths();
const PUBLIC_API_BASE_PLACEHOLDER = 'window.__SUPAOAUTH_PUBLIC_API_BASE__ = null;';

async function findFirstExistingFile(candidates: string[]) {
  for (const candidate of candidates) {
    const file = Bun.file(candidate);
    if (await file.exists()) {
      return file;
    }
  }
  return null;
}

async function loadAuthorizeHtml(): Promise<string | null> {
  // Custom UI takes priority
  const customFile = await findFirstExistingFile(
    hostedPagePaths.customUiDirs.map(dir => path.join(dir, 'index.html')),
  );
  if (customFile) {
    return customFile.text();
  }

  const htmlFile = await findFirstExistingFile(hostedPagePaths.authorizeHtmlCandidates);
  if (htmlFile) {
    return htmlFile.text();
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
  const customFile = await findFirstExistingFile(
    hostedPagePaths.customUiDirs.map(dir => path.join(dir, 'index.html')),
  );
  if (customFile) {
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

function serveFirstStaticFile(fileCandidates: string[]) {
  for (const candidate of fileCandidates) {
    const file = Bun.file(candidate);
    if (file.size) {
      return new Response(file);
    }
  }
  return null;
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
    const resp = serveFirstStaticFile(
      hostedPagePaths.customUiDirs.map(dir => path.join(dir, sub)),
    );
    if (!resp) return new Response('Not Found', { status: 404 });
    return resp;
  })

  // Admin console SPA static assets: /_app/*
  .get('/_app/*', ({ params }) => {
    const sub = (params as Record<string, string>)['*'] || '';
    const resp = serveFirstStaticFile(
      hostedPagePaths.adminConsoleBuildDirs.map(dir => path.join(dir, '_app', sub)),
    );
    if (!resp) return new Response('Not Found', { status: 404 });
    return resp;
  })

  // Admin console SPA pages: /admin/*
  .get('/admin/*', ({ params }) => {
    const sub = (params as Record<string, string>)['*'] || '';
    const resp = serveFirstStaticFile(
      hostedPagePaths.adminConsoleBuildDirs.map(dir => path.join(dir, sub || 'index.html')),
    );
    if (!resp) return new Response('Not Found', { status: 404 });
    return resp;
  })

  // robots.txt
  .get('/robots.txt', () => {
    const resp = serveFirstStaticFile(
      hostedPagePaths.adminConsoleBuildDirs.map(dir => path.join(dir, 'robots.txt')),
    );
    if (!resp) {
      return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } });
    }
    return resp;
  });
