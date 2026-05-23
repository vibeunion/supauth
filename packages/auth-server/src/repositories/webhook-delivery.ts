// Webhook delivery worker — event dispatch, HMAC signing, retry with backoff

import * as auditRepo from './audit.js';
import { getDb } from '../db/index.js';
import { webhooks } from '../db/schema.js';
import { eq } from 'drizzle-orm';

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

/** Dispatch a webhook event to all matching enabled webhooks */
export async function dispatchEvent(event: WebhookEvent): Promise<void> {
  const db = getDb();
  const allWebhooks = await db.select().from(webhooks).where(eq(webhooks.enabled, true));
  const matching = allWebhooks.filter(wh => {
    const events = wh.events as string[];
    return events.includes(event.type) || events.includes('*');
  });

  for (const wh of matching) {
    // Fire-and-forget delivery with retry
    deliverWithRetry(wh.id, wh.url, wh.secret, event).catch(() => {
      // Errors are logged inside deliverWithRetry
    });
  }
}

async function deliverWithRetry(
  webhookId: string,
  url: string,
  secret: string,
  event: WebhookEvent,
  attempt: number = 0,
): Promise<void> {
  const payload = JSON.stringify(event);
  const signature = await computeSignature(payload, secret);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SupaOAuth-Signature': `sha256=${signature}`,
        'X-SupaOAuth-Event': event.type,
        'X-SupaOAuth-Delivery-Id': `${webhookId}-${Date.now()}`,
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
        deliverWithRetry(webhookId, url, secret, event, attempt + 1).catch(() => {});
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
        details: { url, event: event.type, attempts: attempt + 1, error: errorMsg },
      });

      // Disable webhook after max retries
      try {
        const db = getDb();
        await db.update(webhooks).set({ enabled: false, updatedAt: new Date() })
          .where(eq(webhooks.id, webhookId));
      } catch {
        // Don't fail if disable fails
      }
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
  'organization.created',
  'organization.member_added',
  'organization.member_removed',
  'role.assigned',
  'role.revoked',
  'connector.updated',
] as const;

export type SupportedWebhookEvent = typeof SUPPORTED_WEBHOOK_EVENTS[number];
