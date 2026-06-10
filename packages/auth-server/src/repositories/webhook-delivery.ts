// Webhook event facade. SupaCloud owns webhook storage, signing, delivery,
// retry, and diagnostics; SupAuth only submits product events from Function
// handlers so no extra worker/service is required.

import { getSupaCloudAdapter } from '../supacloud/adapter.js';

export interface WebhookEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

/** Build a webhook event envelope */
export function buildEvent(eventType: string, data: Record<string, unknown>): WebhookEvent {
  return {
    type: eventType,
    payload: data,
    timestamp: new Date().toISOString(),
  };
}

/** Submit a webhook event to SupaCloud's managed delivery pipeline. */
export async function dispatchEvent(event: WebhookEvent): Promise<void> {
  await getSupaCloudAdapter().enqueueWebhookEvent(event as unknown as Record<string, unknown>);
}

export const SUPPORTED_WEBHOOK_EVENTS = [
  'user.created',
  'user.signed_in',
  'user.deleted',
  'application.created',
  'application.updated',
  'application.deleted',
  'application.secret_created',
  'organization.created',
  'organization.invitation_created',
  'organization.member_added',
  'organization.member_removed',
  'role.assigned',
  'role.revoked',
  'connector.updated',
  'consent.granted',
  'consent.revoked',
  'org_template.created',
  'organization.created_from_template',
] as const;

export type SupportedWebhookEvent = typeof SUPPORTED_WEBHOOK_EVENTS[number];
