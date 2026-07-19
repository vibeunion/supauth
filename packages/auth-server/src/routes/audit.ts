// Audit log routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import { cursorResponse } from '../utils/api-contract.js';

const adapter = getSupaCloudAdapter();

export const auditRoutes = new Elysia({ prefix: '/v1/audit' })
  .get('/', async ({ query }) => {
    const logs = await adapter.queryAuditLogs({
      event_type: query.event_type,
      resource_type: query.resource_type,
      resource_id: query.resource_id,
      actor_id: query.actor_id,
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
      description: 'Returns admin action audit logs with filtering by event type, resource, actor, and time range',
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
