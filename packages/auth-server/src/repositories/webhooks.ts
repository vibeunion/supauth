// Webhooks repository compatibility facade.
//
// SupaCloud owns webhook definitions, signing keys, delivery logs, retry, and
// disable policy. Keep these exports but do not touch the legacy webhooks table.

import { getSupaCloudAdapter } from '../supacloud/adapter.js';

export async function listWebhooks() {
  return getSupaCloudAdapter().listWebhooks();
}

export async function createWebhook(data: { url: string; events: string[]; enabled?: boolean; signingKeyId?: string }) {
  return getSupaCloudAdapter().createWebhook(data);
}

export async function getWebhook(id: string) {
  return getSupaCloudAdapter().getWebhook(id);
}

export async function updateWebhook(id: string, data: { url?: string; events?: string[]; enabled?: boolean; signingKeyId?: string }) {
  return getSupaCloudAdapter().updateWebhook(id, data);
}

export async function deleteWebhook(id: string) {
  return getSupaCloudAdapter().deleteWebhook(id);
}

export async function rotateWebhookSecret(id: string) {
  return getSupaCloudAdapter().rotateWebhookSecret(id);
}

export async function getWebhookWithSecret(id: string) {
  return getSupaCloudAdapter().getWebhook(id);
}
