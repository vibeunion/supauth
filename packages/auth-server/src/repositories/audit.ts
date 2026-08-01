// Audit facade. SupaCloud owns platform audit storage/querying; SupAuth
// submits product-level events from Function handlers and does not require a
// local audit_logs table on new installs.

import { getConfig } from '../config/index.js';
import type { AdminPrincipal } from '../auth/admin-permissions.js';
import { currentAdminRequestContext, getCurrentRequestId, withAdminRequestContext } from '../auth/request-context.js';
import { getSupaCloudAdapter, isSupaCloudApiError } from '../supacloud/adapter.js';

const SYSTEM_AUDIT_ACTOR_ID = 'supaoauth-system';
const PERSISTED_ACTOR_ID_PATTERN = /^[A-Za-z0-9@._:+/-]{1,200}$/;
const PERSISTED_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:/+-]{1,200}$/;
const AUDIT_IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AuditActor = {
  id: string;
  type: 'admin' | 'user' | 'system';
};

export interface PersistedAdminAuditIdentity {
  actorId: string;
  requestId: string;
  authorizationSource: AdminPrincipal['authorization_source'];
}

function assertPersistableAdminAuditIdentity(identity: PersistedAdminAuditIdentity) {
  if (!PERSISTED_ACTOR_ID_PATTERN.test(identity.actorId)) {
    throw new Error('A persistable admin actor ID is required for durable admin audit events');
  }
  if (!PERSISTED_REQUEST_ID_PATTERN.test(identity.requestId)) {
    throw new Error('A persistable admin request ID is required for durable admin audit events');
  }
}

interface PersistedAdminAuditEvent {
  idempotencyKey: string;
  eventType: string;
  resourceType: string;
  resourceId: string;
  details?: Record<string, unknown>;
}

function isExplicitAuditRejection(error: unknown) {
  return isSupaCloudApiError(error)
    && error.status >= 400
    && error.status < 500;
}

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
  idempotencyKey?: string;
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
  }, event.idempotencyKey);
}

export function currentAdminAuditIdentity(): PersistedAdminAuditIdentity {
  const context = currentAdminRequestContext();
  if (!context) throw new Error('A trusted admin request context is required for durable admin audit events');
  const identity = {
    actorId: context.principal.id,
    requestId: context.requestId,
    authorizationSource: context.principal.authorization_source,
  };
  assertPersistableAdminAuditIdentity(identity);
  return identity;
}

function auditProofPrincipal(identity: PersistedAdminAuditIdentity): AdminPrincipal {
  // Replayed delivery only consumes the persisted ID and authorization source to sign the audit proof.
  return {
    id: identity.actorId,
    email: '',
    name: '',
    roles: [],
    permissions: [],
    authorization_source: identity.authorizationSource,
  };
}

export async function logPersistedAdminAudit(
  identity: PersistedAdminAuditIdentity,
  event: PersistedAdminAuditEvent,
): Promise<'delivered' | 'rejected'> {
  if (!AUDIT_IDEMPOTENCY_KEY_PATTERN.test(event.idempotencyKey)) {
    throw new Error('A UUID audit idempotency key is required for durable admin audit events');
  }
  try {
    await withAdminRequestContext({
      requestId: identity.requestId,
      principal: auditProofPrincipal(identity),
    }, () => logAudit({ ...event, actorType: 'admin' }));
    return 'delivered';
  } catch (error) {
    if (isExplicitAuditRejection(error)) return 'rejected';
    throw error;
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
