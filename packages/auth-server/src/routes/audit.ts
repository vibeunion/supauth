// Audit log routes with OpenAPI annotations

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';

const adapter = getSupaCloudAdapter();

function toListResponse(value: unknown) {
  if (Array.isArray(value)) return { items: value, total: value.length };
  if (value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)) {
    const items = (value as { items: unknown[]; total?: unknown }).items;
    return { items, total: typeof (value as { total?: unknown }).total === 'number' ? (value as { total: number }).total : items.length };
  }
  return { items: [], total: 0 };
}

export const auditRoutes = new Elysia({ prefix: '/v1/audit' })
  .get('/', async ({ query }) => {
    return toListResponse(await adapter.queryAuditLogs({
      event_type: query.event_type,
      resource_type: query.resource_type,
      resource_id: query.resource_id,
      actor_id: query.actor_id,
      limit: query.limit,
      offset: query.offset,
      from: query.from,
      to: query.to,
    }));
  }, {
    detail: {
      summary: 'Query audit logs',
      description: 'Returns admin action audit logs with filtering by event type, resource, actor, and time range',
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
