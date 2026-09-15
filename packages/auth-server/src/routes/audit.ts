// Audit log routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import { ApiContractError, cursorResponse } from '../utils/api-contract.js';
import { operationContract, operationInput, operationOutput } from '../utils/operation-contract.js';

const adapter = getSupaCloudAdapter();

function auditStatus(rawStatus: unknown): number | undefined {
  if (rawStatus === undefined || rawStatus === null || rawStatus === '') return undefined;
  const status = typeof rawStatus === 'number' ? rawStatus : Number(rawStatus);
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new ApiContractError(400, 'invalid_audit_status', 'status must be an HTTP status code from 100 to 599');
  }
  return status;
}

function auditMethod(rawMethod: unknown): string | undefined {
  if (rawMethod === undefined || rawMethod === null || rawMethod === '') return undefined;
  if (typeof rawMethod !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(rawMethod)) {
    throw new ApiContractError(400, 'invalid_audit_method', 'method must be a valid HTTP method token');
  }
  return rawMethod.toUpperCase();
}

export const auditRoutes = new Elysia({ prefix: '/v1/audit' })
  .get('/', async ({ query }) => {
    const logs = await adapter.queryAuditLogs({
      event_type: query["event_type"],
      resource_type: query["resource_type"],
      resource_id: query["resource_id"],
      actor_id: query["actor_id"],
      status: auditStatus(query["status"]),
      method: auditMethod(query["method"]),
      limit: query["limit"],
      offset: query["offset"],
      from: query["from"],
      to: query["to"],
      cursor: query["cursor"],
    });
    return operationOutput('listAuditLogs', cursorResponse(logs, { limit: query["limit"] }));
  }, operationContract('listAuditLogs', {
    detail: {
      summary: 'Query audit logs',
      description: 'Returns admin action audit logs with filtering by event type, resource, actor, HTTP status, method, and time range',
      tags: ['Audit'],
    },
  }, ({ query }) => {
    if (query && typeof query === 'object') {
      if ('status' in query) auditStatus(query.status);
      if ('method' in query) auditMethod(query.method);
    }
  }))
  .post('/export', async ({ body }) => {
    const input = operationInput('createAuditExport', body === undefined ? {} : { body });
    return operationOutput('createAuditExport', await adapter.exportAuditLogs(input.body || {}));
  }, operationContract('createAuditExport', {
    detail: {
      summary: 'Create an asynchronous audit log export',
      tags: ['Audit'],
    },
  }))
  .get('/export', async ({ query }) => {
    return operationOutput('createAuditExportFromQuery', await adapter.exportAuditLogs({
      event_type: query["event_type"],
      resource_type: query["resource_type"],
      resource_id: query["resource_id"],
      actor_id: query["actor_id"],
      from: query["from"],
      to: query["to"],
      format: query["format"],
    }));
  }, operationContract('createAuditExportFromQuery', {
    detail: {
      summary: 'Create an audit log export',
      tags: ['Audit'],
    },
  }))
  .get('/export/:exportId/download', async ({ params }) => adapter.downloadAuditExport(params.exportId), {
    ...operationContract('getAuditExportDownload', {
      detail: { summary: 'Get audit export download information', tags: ['Audit'] },
    }),
  })
  .get('/export/:exportId', async ({ params }) => operationOutput('getAuditExport', await adapter.getAuditExport(params.exportId)), operationContract('getAuditExport', {
    detail: { summary: 'Get audit export job status', tags: ['Audit'] },
  }))
  .get('/integrity', async () => operationOutput('getAuditIntegrity', await adapter.getAuditIntegrity()), operationContract('getAuditIntegrity', {
    detail: {
      summary: 'Get audit append-only integrity checkpoint status',
      tags: ['Audit'],
    },
  }))
  .get('/:logId', async ({ params }) => {
    return operationOutput('getAuditLog', await adapter.getAuditLog(params.logId));
  }, operationContract('getAuditLog', {
    detail: {
      summary: 'Get audit log detail',
      description: 'Returns a single audit log entry including request/project correlation details',
      tags: ['Audit'],
    },
  }));
