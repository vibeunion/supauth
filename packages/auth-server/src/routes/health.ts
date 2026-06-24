// Health / Project / Runtime routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { getConfig } from '../config/index.js';
import { getSupaCloudAdapter, getSupaCloudAdapterForProject } from '../supacloud/adapter.js';
import { checkRuntimeHealth, getDiscovery, getJWKS } from '../runtime/index.js';

const config = getConfig();
const adapter = getSupaCloudAdapter();

function oauthServerAdapter() {
  const oauthProjectRef = getConfig().oauthAuthorizationProjectRef;
  return oauthProjectRef ? getSupaCloudAdapterForProject(oauthProjectRef) : adapter;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function publicAdminUrl(path: string): string {
  const publicBaseUrl = trimTrailingSlash(getConfig().publicBaseUrl || '');
  return publicBaseUrl ? `${publicBaseUrl}${path}` : '';
}

function gotrueLogoutUrl(): string {
  const configured = trimTrailingSlash(process.env.GOTRUE_LOGOUT_URL || '');
  if (configured) return configured;

  const runtimeUrl = trimTrailingSlash(process.env.OAUTH_RUNTIME_URL || process.env.SUPACLOUD_RUNTIME_URL || process.env.SUPABASE_URL || '');
  if (!runtimeUrl) return '';
  return runtimeUrl.endsWith('/auth/v1') ? `${runtimeUrl}/logout` : `${runtimeUrl}/auth/v1/logout`;
}

export function resolvePublicAdminSsoConfig() {
  const issuer = trimTrailingSlash(process.env.ADMIN_SSO_ISSUER || '');
  const clientId = process.env.ADMIN_SSO_CLIENT_ID || '';
  const redirectUri = process.env.ADMIN_SSO_REDIRECT_URI || publicAdminUrl('/admin');
  const postLogoutRedirectUri = process.env.ADMIN_SSO_POST_LOGOUT_REDIRECT_URI || publicAdminUrl('/admin/login');

  return {
    enabled: Boolean(issuer && clientId),
    issuer,
    client_id: clientId,
    redirect_uri: redirectUri,
    post_logout_redirect_uri: postLogoutRedirectUri,
    gotrue_logout_url: gotrueLogoutUrl(),
  };
}

export const healthRoutes = new Elysia({ prefix: '/v1' })
  .get('/health', () => ({
    status: 'ok',
    runtime_mode: config.runtimeMode,
    project_ref: config.projectRef || 'not configured',
  }), {
    detail: {
      summary: 'Server health check',
      tags: ['Health'],
    },
  })
  .get('/project', async () => adapter.getProject(), {
    detail: {
      summary: 'Get project info',
      tags: ['Project'],
    },
  })
  .get('/public/admin-sso-config', () => resolvePublicAdminSsoConfig(), {
    detail: {
      summary: 'Get public admin SSO browser configuration',
      description: 'Returns only public OIDC client metadata needed by the Admin SPA. Secrets, allowlists, and token validation policy stay server-side.',
      tags: ['Auth'],
    },
  });

export const runtimeRoutes = new Elysia({ prefix: '/v1/runtime' })
  .get('/health', async () => checkRuntimeHealth(), {
    detail: {
      summary: 'Check OIDC runtime health',
      tags: ['Runtime'],
    },
  })
  .get('/oauth-server', async () => oauthServerAdapter().getOAuthServerStatus(), {
    detail: {
      summary: 'Get OAuth server status',
      tags: ['Runtime'],
    },
  })
  .get('/discovery', async () => getDiscovery(), {
    detail: {
      summary: 'OIDC discovery document',
      description: 'Returns the OpenID Connect discovery document from the underlying GoTrue runtime',
      tags: ['Runtime'],
    },
  })
  .get('/jwks', async () => getJWKS(), {
    detail: {
      summary: 'JWKS endpoint',
      description: 'Returns JSON Web Key Set from the underlying GoTrue runtime',
      tags: ['Runtime'],
    },
  });
