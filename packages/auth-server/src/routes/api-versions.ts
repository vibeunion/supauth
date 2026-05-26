// API version routes (P1-10) with OpenAPI annotations

import { Elysia } from 'elysia';
import * as versionRepo from '../repositories/api-versions.js';

export const apiVersionRoutes = new Elysia({ prefix: '/v1/api-versions' })
  .get('/', async () => {
    const items = await versionRepo.listVersions();
    return { items, total: items.length };
  }, {
    detail: { summary: 'List API version changes', tags: ['API Versions'] },
  })

  .get('/:version', async ({ params }) => {
    const items = await versionRepo.getVersionChanges(params.version);
    return { version: params.version, items, total: items.length };
  }, {
    detail: { summary: 'Get changes for a specific API version', tags: ['API Versions'] },
  })

  .post('/', async ({ body }) => {
    const data = body as { version: string; change_type: string; path: string; method: string; description?: string };
    const entry = await versionRepo.recordVersionChange({
      version: data.version,
      changeType: data.change_type as any,
      path: data.path,
      method: data.method,
      description: data.description || null,
    });
    return entry;
  }, {
    detail: { summary: 'Record an API version change', tags: ['API Versions'] },
  });
