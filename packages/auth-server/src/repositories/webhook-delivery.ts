// Webhook event facade. SupaCloud owns webhook storage, signing, delivery,
// retry, and diagnostics. Legacy local delivery helpers remain available for
// compatibility with pre-SupaCloud-native installs and targeted tests.

import { createHmac, randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as auditRepo from './audit.js';
import { getDb } from '../db/index.js';
import { webhooks, webhookDeliveries } from '../db/schema.js';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];
const PROCESSING_STUCK_MS = 10 * 60 * 1000;

function logDiagnosticAudit(event: Parameters<typeof auditRepo.logAudit>[0]) {
  setTimeout(() => {
    auditRepo.logAudit(event).catch(() => {});
  }, 0);
}

async function computeSignature(payload: string, secret: string): Promise<string> {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export interface WebhookEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

/** Build a webhook event envelope. */
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

async function claimPendingDeliveries(limit = 50) {
  const db = getDb();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - PROCESSING_STUCK_MS);
  return db.transaction(async (tx) => {
    const claimed = await tx.select().from(webhookDeliveries)
      .where(and(
        sql`(${webhookDeliveries.status} = 'pending' AND ${webhookDeliveries.nextAttemptAt} <= ${now})
            OR (${webhookDeliveries.status} = 'processing' AND ${webhookDeliveries.updatedAt} < ${staleBefore})`,
      ))
      .limit(limit)
      .for('update', { skipLocked: true });

    if (claimed.length === 0) return [];

    const claimedIds = claimed.map(r => r.id);
    await tx.update(webhookDeliveries).set({
      status: 'processing',
      updatedAt: now,
    }).where(inArray(webhookDeliveries.id, claimedIds));
    return claimed;
  });
}

/** Drain legacy local webhook deliveries that are already queued in Postgres. */
export async function processPendingDeliveries(): Promise<number> {
  const db = getDb();
  const pending = await claimPendingDeliveries();
  if (pending.length === 0) return 0;

  let processed = 0;
  for (const delivery of pending) {
    const whRows = await db.select().from(webhooks)
      .where(eq(webhooks.id, delivery.webhookId)).limit(1);
    const wh = whRows[0];
    if (!wh || !wh.enabled) {
      await db.update(webhookDeliveries).set({
        status: 'failed',
        lastError: 'webhook not found or disabled',
        updatedAt: new Date(),
      }).where(eq(webhookDeliveries.id, delivery.id));
      processed++;
      continue;
    }

    const event: WebhookEvent = {
      type: delivery.eventType,
      payload: delivery.payload as Record<string, unknown>,
      timestamp: delivery.createdAt.toISOString(),
    };

    const result = await deliverWebhookOnce(delivery.webhookId, wh.url, wh.secret, event, delivery.id);
    processed++;

    if (result.ok) {
      await db.update(webhookDeliveries).set({
        status: 'delivered',
        attempts: delivery.attempts + 1,
        lastResponseCode: result.status || null,
        deliveredAt: new Date(),
        nextAttemptAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(webhookDeliveries.id, delivery.id));
      continue;
    }

    const nextAttempts = delivery.attempts + 1;
    if (nextAttempts >= delivery.maxAttempts) {
      await db.update(webhookDeliveries).set({
        status: 'failed',
        attempts: nextAttempts,
        lastError: result.error || `HTTP ${result.status}`,
        lastResponseCode: result.status || null,
        updatedAt: new Date(),
      }).where(eq(webhookDeliveries.id, delivery.id));

      try {
        await db.update(webhooks).set({ enabled: false, updatedAt: new Date() })
          .where(eq(webhooks.id, delivery.webhookId));
      } catch {}
    } else {
      const delay = RETRY_DELAYS_MS[Math.min(nextAttempts - 1, RETRY_DELAYS_MS.length - 1)];
      await db.update(webhookDeliveries).set({
        status: 'pending',
        attempts: nextAttempts,
        lastError: result.error || `HTTP ${result.status}`,
        lastResponseCode: result.status || null,
        nextAttemptAt: new Date(Date.now() + delay),
        updatedAt: new Date(),
      }).where(eq(webhookDeliveries.id, delivery.id));
    }
  }
  return processed;
}

export async function deliverWebhookOnce(
  webhookId: string,
  url: string,
  secret: string,
  event: WebhookEvent,
  deliveryId?: string,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const idempotencyKey = deliveryId || randomUUID();
  const payload = JSON.stringify(event);
  const signature = await computeSignature(payload, secret);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SupaOAuth-Signature': `sha256=${signature}`,
        'X-SupaOAuth-Event': event.type,
        'X-SupaOAuth-Delivery-Id': idempotencyKey,
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });
    logDiagnosticAudit({
      eventType: res.ok ? 'webhook.diagnostic_delivered' : 'webhook.diagnostic_failed',
      resourceType: 'webhook',
      resourceId: webhookId,
      actorType: 'system',
      details: { url, event: event.type, status: res.status },
    });
    return { ok: res.ok, status: res.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logDiagnosticAudit({
      eventType: 'webhook.diagnostic_failed',
      resourceType: 'webhook',
      resourceId: webhookId,
      actorType: 'system',
      details: { url, event: event.type, error: message },
    });
    return { ok: false, error: message };
  }
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
