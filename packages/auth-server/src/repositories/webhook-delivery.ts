// Webhook delivery worker — event dispatch, HMAC signing, retry with backoff

import * as auditRepo from './audit.js';
import { getDb } from '../db/index.js';
import { webhooks, webhookDeliveries } from '../db/schema.js';
import { randomUUID } from 'node:crypto';
import { eq, and, lte, inArray, sql } from 'drizzle-orm';

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000]; // 5s, 30s, 2min

async function computeSignature(payload: string, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

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

/** Dispatch a webhook event: enqueue DB-backed delivery records for durability,
 * then process them immediately. If the process crashes, pending records
 * survive and will be picked up by processPendingDeliveries on next run.
 */
export async function dispatchEvent(event: WebhookEvent): Promise<void> {
  const db = getDb();
  const allWebhooks = await db.select().from(webhooks).where(eq(webhooks.enabled, true));
  const matching = allWebhooks.filter(wh => {
    const events = wh.events as string[];
    return events.includes(event.type) || events.includes('*');
  });

  // Enqueue delivery records so they survive process restarts. We store the
  // event timestamp in its own column to avoid leaking an internal _timestamp
  // key into the payload consumers receive (which must match buildEvent()).
  for (const wh of matching) {
    try {
      await db.insert(webhookDeliveries).values({
        webhookId: wh.id,
        eventType: event.type,
        payload: event.payload,
        status: 'pending',
        attempts: 0,
        maxAttempts: MAX_RETRIES,
        nextAttemptAt: new Date(),
        lastError: null,
      });
    } catch {
      // If queue insert fails, fall back to direct fire-and-forget. Generate a
      // stable delivery id once so all retries of this fallback share it.
      deliverWithRetry(wh.id, wh.url, wh.secret, event, 0, randomUUID()).catch(() => {});
    }
  }

  // Process pending deliveries immediately
  processPendingDeliveries().catch(() => {});
}

// Rows stuck in "processing" longer than this are assumed to belong to a
// crashed worker and are eligible for re-claim by whoever wins the SKIP LOCKED
// race. 10 minutes comfortably exceeds the 10s fetch timeout plus retry delay.
const PROCESSING_STUCK_MS = 10 * 60 * 1000;

/**
 * Atomically claim a batch of due deliveries for this worker.
 *
 * Two sources are claimed in the same transaction:
 *  - due `pending` rows
 *  - `processing` rows whose worker appears to have crashed (stale updatedAt)
 *
 * SELECT ... FOR UPDATE SKIP LOCKED ensures concurrent workers (e.g. the
 * dispatch path racing the periodic worker) never pick the same row, which
 * previously caused duplicate webhook deliveries. Claimed rows are flipped to
 * `processing` so they are invisible to subsequent claims until settled.
 */
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

/** Process all pending webhook deliveries that are due.
 * Called by dispatchEvent and can be called by a periodic worker.
 */
export async function processPendingDeliveries(): Promise<number> {
  const db = getDb();
  const pending = await claimPendingDeliveries();
  if (pending.length === 0) return 0;

  let processed = 0;
  for (const delivery of pending) {
    // Fetch the webhook to get URL and secret
    const whRows = await db.select().from(webhooks)
      .where(eq(webhooks.id, delivery.webhookId)).limit(1);
    const wh = whRows[0];
    if (!wh || !wh.enabled) {
      // Webhook deleted or disabled: mark as failed
      await db.update(webhookDeliveries).set({
        status: 'failed',
        lastError: 'webhook not found or disabled',
        updatedAt: new Date(),
      }).where(eq(webhookDeliveries.id, delivery.id));
      processed++;
      continue;
    }

    // Reconstruct the envelope WITHOUT mutating the stored payload, so the
    // delivered body matches buildEvent()'s shape (no internal _timestamp).
    const event: WebhookEvent = {
      type: delivery.eventType,
      payload: delivery.payload as Record<string, unknown>,
      timestamp: delivery.createdAt.toISOString(),
    };

    // Pass delivery.id as a stable idempotency key so the consumer can
    // dedupe retries and stale reclaim deliveries that carry the same payload.
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
    } else {
      const nextAttempts = delivery.attempts + 1;
      if (nextAttempts >= delivery.maxAttempts) {
        await db.update(webhookDeliveries).set({
          status: 'failed',
          attempts: nextAttempts,
          lastError: result.error || `HTTP ${result.status}`,
          lastResponseCode: result.status || null,
          updatedAt: new Date(),
        }).where(eq(webhookDeliveries.id, delivery.id));

        // Disable webhook after max retries
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
  }
  return processed;
}

/** Deliver one webhook synchronously for diagnostics and manual replay.
 *
 * `deliveryId` is a stable idempotency key sent as X-SupaOAuth-Delivery-Id so
 * the receiver can dedupe the same logical delivery across retries and stale
 * reclaim by the queue worker. When omitted (diagnostic/replay endpoints),
 * a UUID is generated for this single call; note that retries of a fallback
 * fire-and-forget path share the id via deliverWithRetry.
 */
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
    await auditRepo.logAudit({
      eventType: res.ok ? 'webhook.diagnostic_delivered' : 'webhook.diagnostic_failed',
      resourceType: 'webhook',
      resourceId: webhookId,
      actorType: 'system',
      details: { url, event: event.type, status: res.status },
    });
    return { ok: res.ok, status: res.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await auditRepo.logAudit({
      eventType: 'webhook.diagnostic_failed',
      resourceType: 'webhook',
      resourceId: webhookId,
      actorType: 'system',
      details: { url, event: event.type, error: message },
    });
    return { ok: false, error: message };
  }
}

async function deliverWithRetry(
  webhookId: string,
  url: string,
  secret: string,
  event: WebhookEvent,
  attempt: number = 0,
  deliveryId?: string,
): Promise<void> {
  // Generate the idempotency key once on the first attempt so every retry of
  // the same logical delivery carries the same X-SupaOAuth-Delivery-Id.
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

    if (res.ok) {
      await auditRepo.logAudit({
        eventType: 'webhook.delivered',
        resourceType: 'webhook',
        resourceId: webhookId,
        actorType: 'system',
        details: { url, event: event.type, attempt, status: res.status },
      });
      return;
    }

    throw new Error(`Webhook delivery failed: HTTP ${res.status}`);
  } catch (err) {
    const errorMsg = (err as Error).message;

    if (attempt < MAX_RETRIES - 1) {
      const delay = RETRY_DELAYS_MS[attempt];
      setTimeout(() => {
        deliverWithRetry(webhookId, url, secret, event, attempt + 1, idempotencyKey).catch(() => {});
      }, delay);

      await auditRepo.logAudit({
        eventType: 'webhook.retry_scheduled',
        resourceType: 'webhook',
        resourceId: webhookId,
        actorType: 'system',
        details: { url, event: event.type, attempt, nextAttempt: attempt + 1, delay, error: errorMsg },
      });
    } else {
      await auditRepo.logAudit({
        eventType: 'webhook.delivery_failed',
        resourceType: 'webhook',
        resourceId: webhookId,
        actorType: 'system',
        details: { url, event: event.type, attempt, error: errorMsg },
      });
    }
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
