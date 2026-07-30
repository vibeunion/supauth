// Audit facade. SupaCloud owns platform audit storage/querying; SupAuth
// submits product-level events from Function handlers and does not require a
// local audit_logs table on new installs.

import { getConfig } from '../config/index.js';
import { currentAdminRequestContext, getCurrentRequestId } from '../auth/request-context.js';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';

const SYSTEM_AUDIT_ACTOR_ID = 'supaoauth-system';

type AuditActor = {
  id: string;
  type: 'admin' | 'user' | 'system';
};

function auditActor(event: {
  actorId?: string;
  actorType?: AuditActor['type'];
}): AuditActor {
  const requestContext = currentAdminRequestContext();
  if (requestContext) return { id: requestContext.principal.id, type: 'admin' };
  if (event.actorType === 'admin') {
    throw new Error('A trusted admin request context is required for admin audit events');
  }
  if (event.actorType === 'user') {
    if (!event.actorId?.trim()) throw new Error('actorId is required for user audit events');
    return { id: event.actorId, type: 'user' };
  }
  return { id: SYSTEM_AUDIT_ACTOR_ID, type: 'system' };
}

export async function logAudit(event: {
  eventType: string;
  actorId?: string;
  actorType?: 'admin' | 'user' | 'system';
  resourceType: string;
  resourceId: string;
  details?: Record<string, unknown>;
}) {
  const config = getConfig();
  const requestContext = currentAdminRequestContext();
  const actor = auditActor(event);
  return getSupaCloudAdapter().recordAuditEvent({
    event_type: event.eventType,
    actor_id: actor.id,
    actor_type: actor.type,
    resource_type: event.resourceType,
    resource_id: event.resourceId,
    details: {
      ...(event.details || {}),
      request_id: requestContext?.requestId || getCurrentRequestId() || null,
      project_ref: config.projectRef || null,
    },
  });
}

export async function getAuditLog(id: string) {
  return getSupaCloudAdapter().getAuditLog(id);
}

export async function queryAuditLogs(options?: {
  eventType?: string;
  resourceType?: string;
  resourceId?: string;
  actorId?: string;
  limit?: number;
  offset?: number;
  from?: Date;
  to?: Date;
}) {
  return getSupaCloudAdapter().queryAuditLogs({
    event_type: options?.eventType,
    resource_type: options?.resourceType,
    resource_id: options?.resourceId,
    actor_id: options?.actorId,
    limit: options?.limit,
    offset: options?.offset,
    from: options?.from,
    to: options?.to,
  });
}
