// Sign-in Experience and Auth Config routes with OpenAPI annotations

import { Elysia } from 'elysia';
import path from 'node:path';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as sieRepo from '../repositories/sign-in-experience.js';
import * as auditRepo from '../repositories/audit.js';
import { getConfig } from '../config/index.js';

const adapter = getSupaCloudAdapter();
const config = getConfig();

async function audit(eventType: string, resourceType: string, resourceId: string) {
  try { await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin' }); } catch {}
}

function runtimeInternalUrl(path: string) {
  const base = config.oauthRuntimeInternalUrl.replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

const AUTHORIZE_HTML_PATHS = [
  path.resolve(import.meta.dir, '../../../admin-console/static/authorize.html'),
  path.resolve(import.meta.dir, '../../../admin-console/build/authorize.html'),
];
const PUBLIC_API_BASE_PLACEHOLDER = 'window.__SUPAOAUTH_PUBLIC_API_BASE__ = null;';

async function loadAuthorizeHtml(): Promise<string | null> {
  for (const candidate of AUTHORIZE_HTML_PATHS) {
    const file = Bun.file(candidate);
    if (await file.exists()) {
      return file.text();
    }
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

export const sieRoutes = new Elysia({ prefix: '/v1/sign-in-experience' })
  .get('/', async () => sieRepo.getSignInExperience(), {
    detail: { summary: 'Get sign-in experience configuration', tags: ['Sign-in Experience'] },
  })

  .get('/resolve', async ({ query }) => {
    const applicationId = (query as Record<string, unknown>).application_id;
    return sieRepo.resolveSignInExperience(typeof applicationId === 'string' ? applicationId : undefined);
  }, {
    detail: { summary: 'Resolve effective sign-in experience for an application', tags: ['Sign-in Experience', 'Applications'] },
  })

  .put('/', async ({ body }) => {
    const updated = await sieRepo.updateSignInExperience(body as Parameters<typeof sieRepo.updateSignInExperience>[0]);
    await audit('sign_in_experience.update', 'sign_in_experience', updated.id);
    return sieRepo.getSignInExperience();
  }, {
    detail: { summary: 'Update sign-in experience configuration', tags: ['Sign-in Experience'] },
  });

export const publicSignInExperienceRoutes = new Elysia({ prefix: '/v1/public/sign-in-experience' })
  .get('/resolve', async ({ query }) => {
    const q = query as Record<string, unknown>;
    let applicationId = typeof q.application_id === 'string' ? q.application_id : undefined;
    let authorization: Awaited<ReturnType<typeof sieRepo.getOAuthAuthorizationContext>> | null = null;
    if (!applicationId && typeof q.authorization_id === 'string') {
      authorization = await sieRepo.getOAuthAuthorizationContext(q.authorization_id);
      applicationId = authorization?.client_id || undefined;
    }
    const experience = await sieRepo.resolveSignInExperience(applicationId);
    return authorization ? { ...experience, authorization } : experience;
  }, {
    detail: { summary: 'Resolve public effective sign-in experience for hosted login pages', tags: ['Sign-in Experience', 'Public'] },
  });

export const hostedOAuthPageRoutes = new Elysia()
  .get('/oauth/authorize', async ({ request, set }) => {
    const html = await loadAuthorizeHtml();
    if (!html) {
      set.status = 404;
      return { error: 'authorize_page_missing' };
    }
    set.headers['content-type'] = 'text/html; charset=utf-8';
    return renderAuthorizeHtml(html, request.url);
  }, {
    detail: { summary: 'Serve hosted OAuth authorize page', tags: ['Public', 'Consent'] },
  });

export const publicOAuthRoutes = new Elysia({ prefix: '/v1/public/oauth' })
  .post('/authorizations/:authorizationId/approve', async ({ headers, params, set }) => {
    const authorizationHeader = headers.authorization || '';
    const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      set.status = 401;
      return { error: 'missing_bearer_token' };
    }

    const accessToken = match[1];
    const userRes = await fetch(runtimeInternalUrl('/user'), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userRes.ok) {
      set.status = 401;
      return { error: 'invalid_bearer_token' };
    }
    const user = await userRes.json() as { id?: string };
    if (!user.id) {
      set.status = 401;
      return { error: 'invalid_user' };
    }

    const bound = await sieRepo.bindAuthorizationToUser(params.authorizationId, user.id);
    if (!bound) {
      set.status = 404;
      return { error: 'authorization_not_found' };
    }

    const consentRes = await fetch(runtimeInternalUrl(`/oauth/authorizations/${params.authorizationId}/consent`), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'approve' }),
    });
    const payload = await consentRes.json().catch(() => ({}));
    if (!consentRes.ok) {
      set.status = consentRes.status;
      return payload;
    }
    return payload;
  }, {
    detail: { summary: 'Approve hosted OAuth authorization after SupaOAuth login', tags: ['Public', 'Consent'] },
  });

export const authConfigRoutes = new Elysia({ prefix: '/v1/auth-config' })
  .get('/', async () => adapter.getAuthConfig(), {
    detail: { summary: 'Get auth configuration (GoTrue)', tags: ['Auth Config'] },
  })
  .patch('/', async ({ body }) => {
    const updated = await adapter.updateAuthConfig(body as Record<string, unknown>);
    await audit('auth_config.update', 'auth_config', config.projectRef);
    return updated;
  }, {
    detail: { summary: 'Update auth configuration (GoTrue)', tags: ['Auth Config'] },
  });
