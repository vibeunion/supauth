// API version routes (P1-10) with OpenAPI annotations


import * as versionRepo from '../repositories/api-versions.js';
import { operationContract, operationInput, operationOutput } from '../utils/operation-contract.js';
import { defineHttpOperation, defineHttpOperations } from '../http/operation.js';

export const apiVersionRoutes = defineHttpOperations({ prefix: '/v1/api-versions' }, {
  getRoot: defineHttpOperation('GET', '/', async () => {
    const items = await versionRepo.listVersions();
    return operationOutput('listApiVersions', { items, total: items.length });
  }, operationContract('listApiVersions', {
    detail: { summary: 'List API version changes', tags: ['API Versions'] },
  })),

  getByVersion: defineHttpOperation('GET', '/:version', async ({ params }) => {
    const items = await versionRepo.getVersionChanges(params.version);
    return operationOutput('getApiVersion', { version: params.version, items, total: items.length });
  }, operationContract('getApiVersion', {
    detail: { summary: 'Get changes for a specific API version', tags: ['API Versions'] },
  })),

  postRoot: defineHttpOperation('POST', '/', async ({ body }) => {
    const { body: data } = operationInput('createApiVersion', { body });
    const entry = await versionRepo.recordVersionChange({
      version: data.version,
      changeType: data.change_type,
      path: data.path,
      method: data.method,
      description: data.description || null,
    });
    return operationOutput('createApiVersion', entry);
  }, operationContract('createApiVersion', {
    detail: { summary: 'Record an API version change', tags: ['API Versions'] },
  })),
});
