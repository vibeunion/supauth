// API Resources and Scopes routes with OpenAPI annotations


import { managementContract, decodeEndpointBody, decodeEndpointResponse } from '../utils/management-contract.js';
import { requiredRow } from '../utils/defined-fields.js';
import * as resourceRepo from '../repositories/resources.js';
import * as auditRepo from '../repositories/audit.js';
import { ApiContractError, pagedResponse } from '../utils/api-contract.js';
import { defineHttpOperation, defineHttpOperations } from '../http/operation.js';

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details });
}

export const resourceRoutes = defineHttpOperations({ prefix: '/v1/resources' }, {
  getRoot: defineHttpOperation('GET', '/', async () => {
    const items = await resourceRepo.listResources();
    await audit('resource.list', 'resource', 'all');
    return decodeEndpointResponse('listResources', { items, total: items.length });
  }, managementContract("GET", "/v1/resources", {
    detail: { summary: 'List API resources', tags: ['Resources'] },
  })),
  postRoot: defineHttpOperation('POST', '/', async ({ body }) => {
    const created = await resourceRepo.createResource(decodeEndpointBody('createResource', body));
    await audit('resource.create', 'resource', created.id, { name: created.name });
    return decodeEndpointResponse('createResource', created);
  }, managementContract("POST", "/v1/resources", {
    detail: { summary: 'Create API resource', tags: ['Resources'] },
  })),
  getByResourceId: defineHttpOperation('GET', '/:resourceId', async ({ params }) => {
    const resource = await resourceRepo.getResource(params.resourceId);
    if (!resource) return new Response('Not found', { status: 404 });
    return decodeEndpointResponse('getResource', resource);
  }, managementContract("GET", "/v1/resources/:resourceId", {
    detail: { summary: 'Get API resource by ID', tags: ['Resources'] },
  })),
  putByResourceId: defineHttpOperation('PUT', '/:resourceId', async ({ params, body }) => {
    const updated = await resourceRepo.updateResource(params.resourceId, decodeEndpointBody('updateResource', body === undefined ? {} : body));
    await audit('resource.update', 'resource', params.resourceId);
    return updated === undefined ? undefined : decodeEndpointResponse('updateResource', updated);
  }, managementContract("PUT", "/v1/resources/:resourceId", {
    detail: { summary: 'Update API resource', tags: ['Resources'] },
  })),
  deleteByResourceId: defineHttpOperation('DELETE', '/:resourceId', async ({ params }) => {
    const bindings = await resourceRepo.resourceBindings(params.resourceId);
    if (bindings.length > 0) {
      throw new ApiContractError(409, 'resource_in_use', 'API resource is bound to one or more applications', {
        binding_count: bindings.length,
      });
    }
    await resourceRepo.deleteResource(params.resourceId);
    await audit('resource.delete', 'resource', params.resourceId);
  }, managementContract("DELETE", "/v1/resources/:resourceId", {
    detail: { summary: 'Delete API resource', tags: ['Resources'] },
  })),
  postByResourceIdScopes: defineHttpOperation('POST', '/:resourceId/scopes', async ({ params, body }) => {
    const scope = requiredRow(await resourceRepo.addScope(params.resourceId, decodeEndpointBody('addScope', body)));
    await audit('scope.create', 'scope', scope.id, { resource_id: params.resourceId });
    return decodeEndpointResponse('addScope', scope);
  }, managementContract("POST", "/v1/resources/:resourceId/scopes", {
    detail: { summary: 'Add scope to resource', tags: ['Resources', 'Scopes'] },
  })),
  putByResourceIdScopesByScopeId: defineHttpOperation('PUT', '/:resourceId/scopes/:scopeId', async ({ params, body }) => {
    const resource = await resourceRepo.getResource(params.resourceId);
    if (!resource || !resource.scopes.some((scope) => scope.id === params.scopeId)) {
      throw new ApiContractError(404, 'scope_not_found', 'Scope was not found under this API resource');
    }
    const scope = await resourceRepo.updateScope(params.scopeId, decodeEndpointBody('updateScope', body));
    await audit('scope.update', 'scope', params.scopeId, { resource_id: params.resourceId });
    return scope === undefined ? undefined : decodeEndpointResponse('updateScope', scope);
  }, managementContract("PUT", "/v1/resources/:resourceId/scopes/:scopeId", {
    detail: { summary: 'Update scope under a resource', tags: ['Resources', 'Scopes'] },
  })),
  deleteByResourceIdScopesByScopeId: defineHttpOperation('DELETE', '/:resourceId/scopes/:scopeId', async ({ params }) => {
    const deletion = await resourceRepo.removeScope(params.resourceId, params.scopeId);
    if (deletion === 'not_found') {
      throw new ApiContractError(404, 'scope_not_found', 'Scope was not found under this API resource');
    }
    if (deletion === 'in_use') {
      throw new ApiContractError(409, 'scope_in_use', 'Scope is bound to one or more applications');
    }
    await audit('scope.delete', 'scope', params.scopeId);
  }, managementContract("DELETE", "/v1/resources/:resourceId/scopes/:scopeId", {
    detail: { summary: 'Remove scope from resource', tags: ['Resources', 'Scopes'] },
  })),
  getByResourceIdApplications: defineHttpOperation('GET', '/:resourceId/applications', async ({ params }) => {
    return decodeEndpointResponse('listResourceApplications', pagedResponse(await resourceRepo.resourceBindings(params.resourceId)));
  }, managementContract("GET", "/v1/resources/:resourceId/applications", {
    detail: { summary: 'List application bindings for a resource', tags: ['Resources', 'Applications'] },
  })),
});
