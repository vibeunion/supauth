// Audit facade. SupaCloud owns platform audit storage/querying; SupAuth
// submits product-level events from Function handlers and does not require a
// local audit_logs table on new installs.

import { getConfig } from '../config/index.js';
import { getCurrentRequestId } from '../middleware/index.js';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';

export async function logAudit(event: {
  eventType: string;
  actorId?: string;
  actorType?: 'admin' | 'user' | 'system';
  resourceType: string;
  resourceId: string;
  details?: Record<string, unknown>;
}) {
  const config = getConfig();
  try {
    return await getSupaCloudAdapter().recordAuditEvent({
      event_type: event.eventType,
      actor_id: event.actorId || null,
      actor_type: event.actorType || 'system',
      resource_type: event.resourceType,
      resource_id: event.resourceId,
      details: {
        ...(event.details || {}),
        request_id: getCurrentRequestId() || null,
        project_ref: config.projectRef || null,
      },
    });
  } catch {
    return null;
  }
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
