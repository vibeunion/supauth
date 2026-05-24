// Health / Project / Runtime routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { getConfig } from '../config/index.js';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import { checkRuntimeHealth, getDiscovery, getJWKS } from '../runtime/index.js';

const config = getConfig();
const adapter = getSupaCloudAdapter();

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
  });

export const runtimeRoutes = new Elysia({ prefix: '/v1/runtime' })
  .get('/health', async () => checkRuntimeHealth(), {
    detail: {
      summary: 'Check OIDC runtime health',
      tags: ['Runtime'],
    },
  })
  .get('/oauth-server', async () => adapter.getOAuthServerStatus(), {
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
