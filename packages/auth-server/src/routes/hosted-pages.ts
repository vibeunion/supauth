// Hosted static pages: authorize UI, login redirect, admin console SPA.
// The SupaOAuth HTTP app owns these hosted-page routes.

import { Elysia } from 'elysia';
import path from 'node:path';
import {
  EMBEDDED_ACCOUNT_HTML,
  EMBEDDED_AUTHORIZE_HTML,
  EMBEDDED_CHANGE_PASSWORD_HTML,
  EMBEDDED_CLAIM_HTML,
  EMBEDDED_HOSTED_SESSION_JS,
  EMBEDDED_LOGOUT_HTML,
} from '../generated/hosted-pages.js';
import { LOGOUT_PAGE_HEADERS, resolvePostLogoutRedirect } from './logout-page.js';

function uniquePaths(paths: string[]) {
  return [...new Set(paths.map(candidate => path.normalize(candidate)))];
}

export function resolveHostedPagePaths(importMetaDir = import.meta.dir, cwd = process.cwd()) {
  const adminConsoleBuildDirs = uniquePaths([
    path.resolve(importMetaDir, 'admin-console/build'),
    path.resolve(importMetaDir, '.src-supauth/admin-console/build'),
    path.resolve(importMetaDir, 'src/admin-console/build'),
    path.resolve(importMetaDir, '../../../admin-console/build'),
    path.resolve(importMetaDir, '../../admin-console/build'),
    path.resolve(cwd, '../admin-console/build'),
    path.resolve(cwd, 'packages/admin-console/build'),
  ]);

  const authorizeHtmlCandidates = uniquePaths([
    path.resolve(importMetaDir, '../../../admin-console/static/authorize.html'),
    path.resolve(importMetaDir, '../../admin-console/static/authorize.html'),
    path.resolve(cwd, '../admin-console/static/authorize.html'),
    path.resolve(cwd, 'packages/admin-console/static/authorize.html'),
    ...adminConsoleBuildDirs.map(dir => path.join(dir, 'authorize.html')),
  ]);

  const claimHtmlCandidates = uniquePaths([
    path.resolve(importMetaDir, '../../../admin-console/static/claim.html'),
    path.resolve(importMetaDir, '../../admin-console/static/claim.html'),
    path.resolve(cwd, '../admin-console/static/claim.html'),
    path.resolve(cwd, 'packages/admin-console/static/claim.html'),
    ...adminConsoleBuildDirs.map(dir => path.join(dir, 'claim.html')),
  ]);

  const changePasswordHtmlCandidates = uniquePaths([
    path.resolve(importMetaDir, '../../../admin-console/static/change-password.html'),
    path.resolve(importMetaDir, '../../admin-console/static/change-password.html'),
    path.resolve(cwd, '../admin-console/static/change-password.html'),
    path.resolve(cwd, 'packages/admin-console/static/change-password.html'),
    ...adminConsoleBuildDirs.map(dir => path.join(dir, 'change-password.html')),
  ]);

  const accountHtmlCandidates = uniquePaths([
    path.resolve(importMetaDir, '../../../admin-console/static/account.html'),
    path.resolve(importMetaDir, '../../admin-console/static/account.html'),
    path.resolve(cwd, '../admin-console/static/account.html'),
    path.resolve(cwd, 'packages/admin-console/static/account.html'),
    ...adminConsoleBuildDirs.map(dir => path.join(dir, 'account.html')),
  ]);

  const logoutHtmlCandidates = uniquePaths([
    path.resolve(importMetaDir, '../../../admin-console/static/logout.html'),
    path.resolve(importMetaDir, '../../admin-console/static/logout.html'),
    path.resolve(cwd, '../admin-console/static/logout.html'),
    path.resolve(cwd, 'packages/admin-console/static/logout.html'),
    ...adminConsoleBuildDirs.map(dir => path.join(dir, 'logout.html')),
  ]);

  return {
    adminConsoleBuildDirs,
    authorizeHtmlCandidates,
    claimHtmlCandidates,
    changePasswordHtmlCandidates,
    accountHtmlCandidates,
    logoutHtmlCandidates,
  };
}

const hostedPagePaths = resolveHostedPagePaths();
const PUBLIC_API_BASE_PLACEHOLDER = 'window.__SUPAOAUTH_PUBLIC_API_BASE__ = null;';
const SAME_ORIGIN_PUBLIC_API_BASE = '/v1/public';
const ADMIN_PATH_DECODE_LIMIT = 4;
const STATIC_CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.otf', 'font/otf'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0f172a"/>
  <path d="M19 22.5c0-5.2 4.2-9.5 9.5-9.5H48v9H28.5a.5.5 0 0 0-.5.5V28h17v8H28v5.5c0 .3.2.5.5.5H48v9H28.5c-5.3 0-9.5-4.3-9.5-9.5v-19Z" fill="#f8fafc"/>
</svg>`;

function isProjectConfinementError(error: unknown) {
  return error instanceof Error
    && error.message.startsWith('Access denied: path "')
    && error.message.endsWith('" is outside the project directory');
}

export async function readFirstAvailableText(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      const file = Bun.file(candidate);
      if (await file.exists()) return await file.text();
    } catch (error) {
      if (!isProjectConfinementError(error)) throw error;
    }
  }
  return null;
}

function decodedAdminPath(sub: string) {
  let decoded = sub;
  try {
    for (let pass = 0; pass < ADMIN_PATH_DECODE_LIMIT; pass += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch (error) {
    if (!(error instanceof URIError)) throw error;
    return null;
  }
  return /%[0-9a-f]{2}/i.test(decoded) || decoded.includes('\0') ? null : decoded;
}

function confinedBuildPath(buildDir: string, candidate: string) {
  const root = path.resolve(buildDir);
  const resolved = path.resolve(root, candidate);
  const relative = path.relative(root, resolved);
  const escaped = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  return escaped ? null : resolved;
}

export function adminConsoleSpaCandidates(buildDirs: string[], sub: string) {
  const decodedSub = decodedAdminPath(sub);
  if (decodedSub === null || path.isAbsolute(decodedSub)) return [];
  const shouldFallbackToIndex = !decodedSub.startsWith('_app/') && !decodedSub.startsWith('assets/');
  return buildDirs.flatMap(buildDir => {
    if (decodedSub && confinedBuildPath(buildDir, decodedSub) === null) return [];
    const relativeCandidates = decodedSub
      ? [
        decodedSub,
        `${decodedSub}.html`,
        path.join(decodedSub, 'index.html'),
      ]
      : [];
    if (shouldFallbackToIndex) relativeCandidates.push('index.html');
    return relativeCandidates
      .map(candidate => confinedBuildPath(buildDir, candidate))
      .filter((candidate): candidate is string => candidate !== null);
  });
}

const LEGACY_ADMIN_REDIRECTS = new Map([
  ['/admin', '/admin/get-started'],
  ['/admin/audit', '/admin/audit-logs'],
  ['/admin/settings', '/admin/tenant-settings/settings'],
  ['/admin/account-center', '/admin/sign-in-experience/account-center'],
  ['/admin/operations', '/admin/tenant-settings/diagnostics'],
  ['/admin/consents', '/admin/applications'],
  ['/admin/tenant-config', '/admin/tenant-settings/advanced'],
  ['/admin/tenant-settings', '/admin/tenant-settings/settings'],
  ['/admin/org-templates', '/admin/organization-template'],
  ['/admin/resources', '/admin/api-resources'],
  ['/admin/sign-in-experience', '/admin/sign-in-experience/branding'],
  ['/admin/security', '/admin/security/password'],
]);

const ADMIN_DETAIL_DEFAULT_TABS = new Map([
  ['applications', 'settings'],
  ['users', 'settings'],
  ['organizations', 'settings'],
  ['roles', 'general'],
  ['api-resources', 'general'],
  ['webhooks', 'settings'],
  ['enterprise-sso', 'connection'],
]);

export function adminConsoleRedirectLocation(requestUrl: URL) {
  const pathname = requestUrl.pathname.replace(/\/$/, '') || '/';
  const legacyTarget = LEGACY_ADMIN_REDIRECTS.get(pathname);
  if (legacyTarget) return `${legacyTarget}${requestUrl.search}`;

  const detailMatch = pathname.match(/^\/admin\/([^/]+)\/([^/]+)$/);
  const defaultTab = detailMatch
    ? ADMIN_DETAIL_DEFAULT_TABS.get(detailMatch[1])
    : undefined;
  return defaultTab
    ? `${pathname}/${defaultTab}${requestUrl.search}`
    : null;
}

async function loadAuthorizeHtml(): Promise<string | null> {
  return await readFirstAvailableText(hostedPagePaths.authorizeHtmlCandidates)
    ?? EMBEDDED_AUTHORIZE_HTML;
}

async function loadClaimHtml(): Promise<string | null> {
  return await readFirstAvailableText(hostedPagePaths.claimHtmlCandidates)
    ?? EMBEDDED_CLAIM_HTML;
}

async function loadChangePasswordHtml(): Promise<string | null> {
  return await readFirstAvailableText(hostedPagePaths.changePasswordHtmlCandidates)
    ?? EMBEDDED_CHANGE_PASSWORD_HTML;
}

async function loadAccountHtml(): Promise<string | null> {
  return await readFirstAvailableText(hostedPagePaths.accountHtmlCandidates)
    ?? EMBEDDED_ACCOUNT_HTML;
}

async function loadLogoutHtml(): Promise<string | null> {
  return await readFirstAvailableText(hostedPagePaths.logoutHtmlCandidates)
    ?? EMBEDDED_LOGOUT_HTML;
}

function renderAuthorizeHtml(html: string) {
  return html.replace(
    PUBLIC_API_BASE_PLACEHOLDER,
    `window.__SUPAOAUTH_PUBLIC_API_BASE__ = ${JSON.stringify(SAME_ORIGIN_PUBLIC_API_BASE)};`,
  );
}

function renderPublicHtml(html: string) {
  return html.replace(
    PUBLIC_API_BASE_PLACEHOLDER,
    `window.__SUPAOAUTH_PUBLIC_API_BASE__ = ${JSON.stringify(SAME_ORIGIN_PUBLIC_API_BASE)};`,
  );
}

function renderLogoutHtml(html: string, redirectUri: string) {
  const encodedRedirect = JSON.stringify(redirectUri).replace(/</g, '\\u003c');
  return html.replace(
    'window.__SUPAOAUTH_POST_LOGOUT_REDIRECT__ = null;',
    `window.__SUPAOAUTH_POST_LOGOUT_REDIRECT__ = ${encodedRedirect};`,
  );
}

const defaultHtmlCache: { html: string | null; checkedAt: number } = { html: null, checkedAt: 0 };
const CACHE_TTL = 60_000;

async function getAuthorizeHtml() {
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
    try {
      const file = Bun.file(candidate);
      if (file.size) {
        return new Response(file, {
          headers: {
            'content-type': STATIC_CONTENT_TYPES.get(path.extname(candidate).toLowerCase()) || 'application/octet-stream',
            'x-content-type-options': 'nosniff',
          },
        });
      }
    } catch (error) {
      if (!isProjectConfinementError(error)) throw error;
    }
  }
  return null;
}

function serveFavicon() {
  return new Response(FAVICON_SVG, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  });
}

function adminConsoleRedirectResponse(request: Request) {
  const location = adminConsoleRedirectLocation(new URL(request.url));
  return location
    ? new Response(null, { status: 307, headers: { location } })
    : null;
}

export function serveAdminConsolePage(buildDirs: string[], sub: string) {
  return serveFirstStaticFile(
    adminConsoleSpaCandidates(buildDirs, sub),
  ) || new Response('Not Found', { status: 404 });
}

async function serveLogoutPage(request: Request, query: Record<string, unknown>) {
  const html = await loadLogoutHtml();
  if (!html) return new Response('Not Found', { status: 404 });
  const redirectUri = await resolvePostLogoutRedirect(request, query);
  return new Response(renderLogoutHtml(html, redirectUri), { headers: LOGOUT_PAGE_HEADERS });
}

export const hostedPageRoutes = new Elysia()
  .get('/hosted-auth.js', () => new Response(EMBEDDED_HOSTED_SESSION_JS, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store',
    },
  }), {
    detail: { summary: 'Serve hosted authentication session client', tags: ['Public'] },
  })

  .get('/favicon.ico', serveFavicon, {
    detail: { summary: 'Serve hosted favicon', tags: ['Public'] },
  })

  .get('/favicon.svg', serveFavicon, {
    detail: { summary: 'Serve hosted favicon SVG', tags: ['Public'] },
  })

  // Hosted OAuth authorize page
  .get('/oauth/authorize', async ({ set }) => {
    const html = await getAuthorizeHtml();
    if (!html) {
      set.status = 404;
      return { error: 'authorize_page_missing' };
    }
    set.headers['content-type'] = 'text/html; charset=utf-8';
    return renderAuthorizeHtml(html);
  }, {
    detail: { summary: 'Serve hosted OAuth authorize page', tags: ['Public', 'Consent'] },
  })

  // Login page and root redirect to authorize
  .get('/login.html', async ({ set }) => {
    const html = await getAuthorizeHtml();
    if (!html) {
      set.status = 404;
      return { error: 'authorize_page_missing' };
    }
    set.headers['content-type'] = 'text/html; charset=utf-8';
    return renderAuthorizeHtml(html);
  }, {
    detail: { summary: 'Serve hosted login page (alias for authorize)', tags: ['Public'] },
  })

  .get('/login', async ({ set }) => {
    const html = await getAuthorizeHtml();
    if (!html) {
      set.status = 404;
      return { error: 'authorize_page_missing' };
    }
    set.headers['content-type'] = 'text/html; charset=utf-8';
    return renderAuthorizeHtml(html);
  }, {
    detail: { summary: 'Serve hosted login path alias', tags: ['Public'] },
  })

  .get('/authorize.html', async ({ set }) => {
    const html = await getAuthorizeHtml();
    if (!html) {
      set.status = 404;
      return { error: 'authorize_page_missing' };
    }
    set.headers['content-type'] = 'text/html; charset=utf-8';
    return renderAuthorizeHtml(html);
  }, {
    detail: { summary: 'Serve hosted authorize page alias', tags: ['Public', 'Consent'] },
  })

  .get('/logout', ({ query, request }) => (
    serveLogoutPage(request, query as Record<string, unknown>)
  ), {
    detail: { summary: 'End the current SupAuth session', tags: ['Public'] },
  })

  .get('/logout.html', ({ query, request }) => (
    serveLogoutPage(request, query as Record<string, unknown>)
  ), {
    detail: { summary: 'End the current SupAuth session HTML alias', tags: ['Public'] },
  })

  .get('/claim', async ({ set }) => {
    const html = await loadClaimHtml();
    if (!html) {
      set.status = 404;
      return { error: 'claim_page_missing' };
    }
    set.headers['content-type'] = 'text/html; charset=utf-8';
    return renderPublicHtml(html);
  }, {
    detail: { summary: 'Serve account claim page', tags: ['Public', 'Account Provisioning'] },
  })

  .get('/claim.html', async ({ set }) => {
    const html = await loadClaimHtml();
    if (!html) {
      set.status = 404;
      return { error: 'claim_page_missing' };
    }
    set.headers['content-type'] = 'text/html; charset=utf-8';
    return renderPublicHtml(html);
  }, {
    detail: { summary: 'Serve account claim page', tags: ['Public', 'Account Provisioning'] },
  })

  .get('/account', async ({ set }) => {
    const html = await loadAccountHtml();
    if (!html) {
      set.status = 404;
      return { error: 'account_page_missing' };
    }
    set.headers['content-type'] = 'text/html; charset=utf-8';
    return renderPublicHtml(html);
  }, {
    detail: { summary: 'Serve hosted account center page', tags: ['Public', 'Account Center'] },
  })

  .get('/account.html', async ({ set }) => {
    const html = await loadAccountHtml();
    if (!html) {
      set.status = 404;
      return { error: 'account_page_missing' };
    }
    set.headers['content-type'] = 'text/html; charset=utf-8';
    return renderPublicHtml(html);
  }, {
    detail: { summary: 'Serve hosted account center HTML alias', tags: ['Public', 'Account Center'] },
  })

  .get('/account/password', async ({ set }) => {
    const html = await loadChangePasswordHtml();
    if (!html) {
      set.status = 404;
      return { error: 'change_password_page_missing' };
    }
    set.headers['content-type'] = 'text/html; charset=utf-8';
    return renderPublicHtml(html);
  }, {
    detail: { summary: 'Serve hosted password change page', tags: ['Public', 'Account Center'] },
  })

  .get('/change-password', async ({ set }) => {
    const html = await loadChangePasswordHtml();
    if (!html) {
      set.status = 404;
      return { error: 'change_password_page_missing' };
    }
    set.headers['content-type'] = 'text/html; charset=utf-8';
    return renderPublicHtml(html);
  }, {
    detail: { summary: 'Serve hosted password change page alias', tags: ['Public', 'Account Center'] },
  })

  .get('/change-password.html', async ({ set }) => {
    const html = await loadChangePasswordHtml();
    if (!html) {
      set.status = 404;
      return { error: 'change_password_page_missing' };
    }
    set.headers['content-type'] = 'text/html; charset=utf-8';
    return renderPublicHtml(html);
  }, {
    detail: { summary: 'Serve hosted password change HTML alias', tags: ['Public', 'Account Center'] },
  })

  .get('/', async ({ set }) => {
    const html = await getAuthorizeHtml();
    if (!html) {
      set.status = 404;
      return { error: 'authorize_page_missing' };
    }
    set.headers['content-type'] = 'text/html; charset=utf-8';
    return renderAuthorizeHtml(html);
  }, {
    detail: { summary: 'Serve hosted landing page (alias for authorize)', tags: ['Public'] },
  })

  .get('/custom-ui/*', () => new Response('Not Found', {
    status: 404,
    headers: { 'cache-control': 'no-store' },
  }))

  // Admin console SPA static assets: /_app/*
  .get('/_app/*', ({ params }) => {
    const sub = (params as Record<string, string>)['*'] || '';
    const resp = serveFirstStaticFile(
      hostedPagePaths.adminConsoleBuildDirs.map(dir => path.join(dir, '_app', sub)),
    );
    if (!resp) return new Response('Not Found', { status: 404 });
    return resp;
  })

  .get('/admin', ({ request }) => (
    adminConsoleRedirectResponse(request) || serveAdminConsolePage(hostedPagePaths.adminConsoleBuildDirs, '')
  ))

  // Admin console SPA pages: /admin/*
  .get('/admin/*', ({ params, request }) => {
    const redirectResponse = adminConsoleRedirectResponse(request);
    if (redirectResponse) return redirectResponse;
    const sub = (params as Record<string, string>)['*'] || '';
    return serveAdminConsolePage(hostedPagePaths.adminConsoleBuildDirs, sub);
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
