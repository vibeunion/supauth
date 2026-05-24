// API Resources and Scopes routes with OpenAPI annotations

import { Elysia, t } from 'elysia';
import * as resourceRepo from '../repositories/resources.js';
import * as auditRepo from '../repositories/audit.js';

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  try { await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details }); } catch {}
}

export const resourceRoutes = new Elysia({ prefix: '/v1/resources' })
  .get('/', async () => {
    const items = await resourceRepo.listResources();
    await audit('resource.list', 'resource', 'all');
    return { items, total: items.length };
  }, {
    detail: { summary: 'List API resources', tags: ['Resources'] },
  })
  .post('/', async ({ body }) => {
    const created = await resourceRepo.createResource(body as { name: string; indicator: string; description?: string; scopes?: { name: string; description?: string }[] });
    await audit('resource.create', 'resource', created.id, { name: created.name });
    return created;
  }, {
    detail: { summary: 'Create API resource', tags: ['Resources'] },
  })
  .get('/:resourceId', async ({ params }) => {
    const resource = await resourceRepo.getResource(params.resourceId);
    if (!resource) return new Response('Not found', { status: 404 });
    return resource;
  }, {
    detail: { summary: 'Get API resource by ID', tags: ['Resources'] },
  })
  .put('/:resourceId', async ({ params, body }) => {
    const updated = await resourceRepo.updateResource(params.resourceId, body as { name?: string; indicator?: string; description?: string });
    await audit('resource.update', 'resource', params.resourceId);
    return updated;
  }, {
    detail: { summary: 'Update API resource', tags: ['Resources'] },
  })
  .delete('/:resourceId', async ({ params }) => {
    await resourceRepo.deleteResource(params.resourceId);
    await audit('resource.delete', 'resource', params.resourceId);
  }, {
    detail: { summary: 'Delete API resource', tags: ['Resources'] },
  })
  .post('/:resourceId/scopes', async ({ params, body }) => {
    const scope = await resourceRepo.addScope(params.resourceId, body as { name: string; description?: string });
    await audit('scope.create', 'scope', scope.id, { resource_id: params.resourceId });
    return scope;
  }, {
    detail: { summary: 'Add scope to resource', tags: ['Resources', 'Scopes'] },
  })
  .delete('/:resourceId/scopes/:scopeId', async ({ params }) => {
    await resourceRepo.removeScope(params.scopeId);
    await audit('scope.delete', 'scope', params.scopeId);
  }, {
    detail: { summary: 'Remove scope from resource', tags: ['Resources', 'Scopes'] },
  });
