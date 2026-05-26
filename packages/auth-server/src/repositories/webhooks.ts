// Webhooks repository — backed by SupaCloud Postgres

import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { webhooks } from '../db/schema.js';

function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function listWebhooks() {
  const db = getDb();
  return db.select({
    id: webhooks.id,
    url: webhooks.url,
    events: webhooks.events,
    signingKeyId: webhooks.signingKeyId,
    enabled: webhooks.enabled,
    createdAt: webhooks.createdAt,
    updatedAt: webhooks.updatedAt,
    // Exclude secret from list
  }).from(webhooks).orderBy(webhooks.createdAt);
}

export async function createWebhook(data: { url: string; events: string[]; enabled?: boolean; signingKeyId?: string }) {
  const db = getDb();
  const secret = generateSecret();
  const [webhook] = await db.insert(webhooks).values({
    url: data.url,
    events: data.events,
    secret,
    signingKeyId: data.signingKeyId || `whsec_${Date.now()}`,
    enabled: data.enabled ?? true,
  }).returning();
  return webhook; // includes secret — only returned on create
}

export async function getWebhook(id: string) {
  const db = getDb();
  const rows = await db.select({
    id: webhooks.id,
    url: webhooks.url,
    events: webhooks.events,
    signingKeyId: webhooks.signingKeyId,
    enabled: webhooks.enabled,
    createdAt: webhooks.createdAt,
    updatedAt: webhooks.updatedAt,
  }).from(webhooks).where(eq(webhooks.id, id)).limit(1);
  return rows[0] || null;
}

export async function updateWebhook(id: string, data: { url?: string; events?: string[]; enabled?: boolean; signingKeyId?: string }) {
  const db = getDb();
  const [updated] = await db.update(webhooks).set({
    ...data,
    updatedAt: new Date(),
  }).where(eq(webhooks.id, id)).returning();
  return updated;
}

export async function deleteWebhook(id: string) {
  const db = getDb();
  await db.delete(webhooks).where(eq(webhooks.id, id));
}

export async function rotateWebhookSecret(id: string) {
  const db = getDb();
  const secret = generateSecret();
  const [updated] = await db.update(webhooks).set({ secret, signingKeyId: `whsec_${Date.now()}`, updatedAt: new Date() })
    .where(eq(webhooks.id, id)).returning();
  return updated; // includes new secret
}

export async function getWebhookWithSecret(id: string) {
  const db = getDb();
  const rows = await db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1);
  return rows[0] || null;
}
