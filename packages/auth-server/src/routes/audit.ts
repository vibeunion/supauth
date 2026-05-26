// Audit log routes with OpenAPI annotations

import { Elysia, t } from 'elysia';
import * as auditRepo from '../repositories/audit.js';

export const auditRoutes = new Elysia({ prefix: '/v1/audit' })
  .get('/', async ({ query }) => {
    const options: Parameters<typeof auditRepo.queryAuditLogs>[0] = {};
    if (query.event_type) options.eventType = query.event_type as string;
    if (query.resource_type) options.resourceType = query.resource_type as string;
    if (query.resource_id) options.resourceId = query.resource_id as string;
    if (query.actor_id) options.actorId = query.actor_id as string;
    if (query.limit) options.limit = parseInt(query.limit as string, 10);
    if (query.offset) options.offset = parseInt(query.offset as string, 10);
    if (query.from) options.from = new Date(query.from as string);
    if (query.to) options.to = new Date(query.to as string);
    const items = await auditRepo.queryAuditLogs(options);
    return { items, total: items.length };
  }, {
    detail: {
      summary: 'Query audit logs',
      description: 'Returns admin action audit logs with filtering by event type, resource, actor, and time range',
      tags: ['Audit'],
    },
  })
  .get('/:logId', async ({ params }) => {
    const log = await auditRepo.getAuditLog(params.logId);
    if (!log) return new Response('Not found', { status: 404 });
    return log;
  }, {
    detail: {
      summary: 'Get audit log detail',
      description: 'Returns a single audit log entry including request/project correlation details',
      tags: ['Audit'],
    },
  });
