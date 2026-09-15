// Compatibility inspector routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { runCompatibilityChecks } from '../compatibility/supabase.js';
import { operationContract, operationOutput } from '../utils/operation-contract.js';

export const compatibilityRoutes = new Elysia({ prefix: '/v1/compatibility' })
  .get('/supabase', async () => {
    const results = await runCompatibilityChecks();
    return operationOutput('getCompatibilityReport', {
      checks: results, total: results.length, passed: results.filter(r => r.status === 'pass').length,
    });
  }, operationContract('getCompatibilityReport', {
    detail: {
      summary: 'Run Supabase compatibility checks',
      description: 'Checks OIDC discovery, JWKS, endpoints, SupaCloud connectivity, scopes, and runtime RBAC claim strategy',
      tags: ['Compatibility'],
    },
  }));
