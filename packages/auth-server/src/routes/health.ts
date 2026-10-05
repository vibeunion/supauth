// Health / Project / Runtime routes with OpenAPI annotations


import { isRecord } from '../utils/api-contract.js';
import { getConfig } from '../config/index.js';
import { runtimeEnv } from '../config/platform-env.js';
import { getSupaCloudAdapter, getSupaCloudAdapterForProject } from '../supacloud/adapter.js';
import { checkRuntimeHealth, getDiscovery, getJWKS } from '../runtime/index.js';
import { operationContract, operationOutput } from '../utils/operation-contract.js';
import { defineHttpOperation, defineHttpOperations } from '../http/operation.js';

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

function projectSummary(upstreamProject: unknown) {
  const projectRecord = isRecord(upstreamProject) ? upstreamProject : {};
  return operationOutput('getProject', {
    id: typeof projectRecord["id"] === 'string' ? projectRecord["id"] : undefined,
    ref: typeof projectRecord["ref"] === 'string' ? projectRecord["ref"] : undefined,
    project_ref: typeof projectRecord["project_ref"] === 'string' ? projectRecord["project_ref"] : undefined,
    name: typeof projectRecord["name"] === 'string' ? projectRecord["name"] : undefined,
  });
}

export function resolvePublicAdminSsoConfig() {
  const issuer = trimTrailingSlash(runtimeEnv('ADMIN_SSO_ISSUER') || '');
  const clientId = runtimeEnv('ADMIN_SSO_CLIENT_ID') || '';
  const redirectUri = runtimeEnv('ADMIN_SSO_REDIRECT_URI') || publicAdminUrl('/admin');
  const postLogoutRedirectUri = runtimeEnv('ADMIN_SSO_POST_LOGOUT_REDIRECT_URI') || publicAdminUrl('/admin/login');

  return {
    enabled: Boolean(issuer && clientId),
    issuer,
    client_id: clientId,
    redirect_uri: redirectUri,
    post_logout_redirect_uri: postLogoutRedirectUri,
    end_session_endpoint: publicAdminUrl('/logout'),
  };
}

export const healthRoutes = defineHttpOperations({ prefix: '/v1' }, {
  getHealth: defineHttpOperation('GET', '/health', () => operationOutput('health', {
    status: 'ok',
    runtime_mode: config.runtimeMode,
    project_ref: config.projectRef || 'not configured',
  }), operationContract('health', {
    detail: {
      summary: 'Server health check',
      tags: ['Health'],
    },
  })),
  getProject: defineHttpOperation('GET', '/project', async () => projectSummary(await adapter.getProject()), operationContract('getProject', {
    detail: {
      summary: 'Get project info',
      tags: ['Project'],
    },
  })),
  getPublicAdminSsoConfig: defineHttpOperation('GET', '/public/admin-sso-config', () => resolvePublicAdminSsoConfig(), operationContract('getPublicAdminSsoConfig', {
    detail: {
      summary: 'Get public admin SSO browser configuration',
      description: 'Returns only public OIDC client metadata needed by the Admin SPA. Secrets, allowlists, and token validation policy stay server-side.',
      tags: ['Auth'],
    },
  })),
});

export const runtimeRoutes = defineHttpOperations({ prefix: '/v1/runtime' }, {
  getHealth: defineHttpOperation('GET', '/health', async () => operationOutput('getRuntimeHealth', await checkRuntimeHealth()), operationContract('getRuntimeHealth', {
    detail: {
      summary: 'Check OIDC runtime health',
      tags: ['Runtime'],
    },
  })),
  getOauthServer: defineHttpOperation('GET', '/oauth-server', async () => operationOutput('getOAuthServerStatus', await oauthServerAdapter().getOAuthServerStatus()), operationContract('getOAuthServerStatus', {
    detail: {
      summary: 'Get OAuth server status',
      tags: ['Runtime'],
    },
  })),
  getDiscovery: defineHttpOperation('GET', '/discovery', async () => operationOutput('getDiscovery', await getDiscovery()), operationContract('getDiscovery', {
    detail: {
      summary: 'OIDC discovery document',
      description: 'Returns the OpenID Connect discovery document from the underlying GoTrue runtime',
      tags: ['Runtime'],
    },
  })),
  getJwks: defineHttpOperation('GET', '/jwks', async () => operationOutput('getJWKS', await getJWKS()), operationContract('getJWKS', {
    detail: {
      summary: 'JWKS endpoint',
      description: 'Returns JSON Web Key Set from the underlying GoTrue runtime',
      tags: ['Runtime'],
    },
  })),
});
