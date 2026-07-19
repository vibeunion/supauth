// SupaCloud owns webhook storage, signing, delivery, retry, and diagnostics.

import { createHash } from 'node:crypto';
import { getCurrentRequestId } from '../auth/request-context.js';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import type { ManagedWebhookEvent } from '../supacloud/adapter.js';

const WEBHOOK_API_VERSION = '2026-07-01';
const WEBHOOK_EVENT_UUID_NAMESPACE = Buffer.from('0db8c2f190d74ef28ec066780cff26d6', 'hex');

function formatUuid(uuidBytes: Buffer): string {
  const uuidHex = uuidBytes.subarray(0, 16).toString('hex');
  return `${uuidHex.slice(0, 8)}-${uuidHex.slice(8, 12)}-${uuidHex.slice(12, 16)}-${uuidHex.slice(16, 20)}-${uuidHex.slice(20, 32)}`;
}

function requestEventUuid(requestId: string, eventType: string): string {
  const eventIdentity = `${requestId.length}:${requestId}${eventType.length}:${eventType}`;
  // UUIDv5 mandates SHA-1; this digest is an idempotency identifier, not a security primitive.
  const uuidBytes = createHash('sha1')
    .update(WEBHOOK_EVENT_UUID_NAMESPACE)
    .update(eventIdentity)
    .digest();
  uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x50;
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;
  return formatUuid(uuidBytes);
}

function webhookEventId(eventType: string): string {
  const requestId = getCurrentRequestId();
  if (!requestId) throw new Error('Cannot build webhook event without an active request ID');
  return requestEventUuid(requestId, eventType);
}

export type WebhookEvent = ManagedWebhookEvent;

/** Build a webhook event envelope. */
export function buildEvent(eventType: string, payload: Record<string, unknown>): WebhookEvent {
  return {
    id: webhookEventId(eventType),
    type: eventType,
    payload,
    occurred_at: new Date().toISOString(),
    api_version: WEBHOOK_API_VERSION,
  };
}

/** Submit a webhook event to SupaCloud's managed delivery pipeline. */
export async function dispatchEvent(event: WebhookEvent): Promise<void> {
  await getSupaCloudAdapter().enqueueWebhookEvent(event);
}

export const WEBHOOK_EVENT_CATALOG = [
  { type: 'user.created', guarantee: 'post_mutation' },
  { type: 'user.updated', guarantee: 'post_mutation' },
  { type: 'user.suspended', guarantee: 'post_mutation' },
  { type: 'user.unsuspended', guarantee: 'post_mutation' },
  { type: 'user.deleted', guarantee: 'post_mutation' },
  { type: 'application.created', guarantee: 'post_mutation' },
  { type: 'application.updated', guarantee: 'post_mutation' },
  { type: 'application.deleted', guarantee: 'post_mutation' },
  { type: 'organization.created', guarantee: 'transactional' },
  { type: 'organization.invitation_created', guarantee: 'transactional' },
  { type: 'organization.member_added', guarantee: 'transactional' },
  { type: 'organization.member_updated', guarantee: 'transactional' },
  { type: 'organization.member_removed', guarantee: 'transactional' },
  { type: 'role.assigned', guarantee: 'transactional' },
  { type: 'role.revoked', guarantee: 'transactional' },
  { type: 'connector.updated', guarantee: 'post_mutation' },
  { type: 'org_template.created', guarantee: 'post_mutation' },
  { type: 'organization.created_from_template', guarantee: 'post_mutation' },
] as const;

export const SUPPORTED_WEBHOOK_EVENTS = WEBHOOK_EVENT_CATALOG.map(({ type }) => type);
