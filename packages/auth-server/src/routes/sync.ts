// Metadata sync routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { syncUserMetadata, syncOrgMetadata } from '../sync/index.js';

export const syncRoutes = new Elysia({ prefix: '/v1/sync' })
  .post('/user/:userId', async ({ params, query }) => {
    const orgId = query.org_id as string | undefined;
    return syncUserMetadata(params.userId, orgId);
  }, {
    detail: {
      summary: 'Sync user metadata to GoTrue app_metadata',
      description: 'Pushes SupaOAuth roles/permissions/orgs into GoTrue app_metadata.supaoauth namespace',
      tags: ['Sync'],
    },
  })
  .post('/org/:orgId', async ({ params }) => {
    const results = await syncOrgMetadata(params.orgId);
    return { results, total: results.length, failed: results.filter(r => !r.success).length };
  }, {
    detail: {
      summary: 'Sync organization member metadata to GoTrue',
      description: 'Pushes all org member metadata to their respective GoTrue app_metadata',
      tags: ['Sync'],
    },
  });
