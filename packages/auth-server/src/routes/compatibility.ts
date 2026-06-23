// Compatibility inspector routes with OpenAPI annotations

import { Elysia, t } from 'elysia';
import { runCompatibilityChecks } from '../compatibility/supabase.js';

export const compatibilityRoutes = new Elysia({ prefix: '/v1/compatibility' })
  .get('/supabase', async () => {
    const results = await runCompatibilityChecks();
    return { checks: results, total: results.length, passed: results.filter(r => r.status === 'pass').length };
  }, {
    detail: {
      summary: 'Run Supabase compatibility checks',
      description: 'Checks OIDC discovery, JWKS, endpoints, SupaCloud connectivity, scopes, and runtime RBAC claim strategy',
      tags: ['Compatibility'],
    },
  });
