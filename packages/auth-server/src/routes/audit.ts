// Audit log routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import { ApiContractError, cursorResponse } from '../utils/api-contract.js';

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
      event_type: query.event_type,
      resource_type: query.resource_type,
      resource_id: query.resource_id,
      actor_id: query.actor_id,
      status: auditStatus(query.status),
      method: auditMethod(query.method),
      limit: query.limit,
      offset: query.offset,
      from: query.from,
      to: query.to,
      cursor: query.cursor,
    });
    return cursorResponse(logs, { limit: query.limit });
  }, {
    detail: {
      summary: 'Query audit logs',
      description: 'Returns admin action audit logs with filtering by event type, resource, actor, HTTP status, method, and time range',
      tags: ['Audit'],
    },
  })
  .post('/export', async ({ body }) => {
    return adapter.exportAuditLogs((body || {}) as Record<string, unknown>);
  }, {
    detail: {
      summary: 'Create an asynchronous audit log export',
      tags: ['Audit'],
    },
  })
  .get('/export', async ({ query }) => {
    return adapter.exportAuditLogs({
      event_type: query.event_type,
      resource_type: query.resource_type,
      resource_id: query.resource_id,
      actor_id: query.actor_id,
      from: query.from,
      to: query.to,
      format: query.format,
    });
  }, {
    detail: {
      summary: 'Create an audit log export',
      tags: ['Audit'],
    },
  })
  .get('/export/:exportId/download', async ({ params }) => adapter.downloadAuditExport(params.exportId), {
    detail: { summary: 'Get audit export download information', tags: ['Audit'] },
  })
  .get('/export/:exportId', async ({ params }) => adapter.getAuditExport(params.exportId), {
    detail: { summary: 'Get audit export job status', tags: ['Audit'] },
  })
  .get('/integrity', async () => adapter.getAuditIntegrity(), {
    detail: {
      summary: 'Get audit append-only integrity checkpoint status',
      tags: ['Audit'],
    },
  })
  .get('/:logId', async ({ params }) => {
    return adapter.getAuditLog(params.logId);
  }, {
    detail: {
      summary: 'Get audit log detail',
      description: 'Returns a single audit log entry including request/project correlation details',
      tags: ['Audit'],
    },
  });
