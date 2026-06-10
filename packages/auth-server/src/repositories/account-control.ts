// Account center compatibility facade.
//
// SupaCloud owns user sessions. SupAuth keeps this repository API for older
// internal callers, but session list/record/revoke operations go through
// SupaCloud Management API.

import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import { logAudit } from './audit.js';

export async function listAccountSessions(userId: string) {
  return getSupaCloudAdapter().listUserSessions(userId);
}

export async function recordAccountSession(userId: string, sessionId: string, metadata?: Record<string, unknown>) {
  return getSupaCloudAdapter().recordUserSession(userId, {
    session_id: sessionId,
    metadata: metadata || {},
  });
}

export async function revokeAccountSession(userId: string, sessionId: string) {
  const session = await getSupaCloudAdapter().revokeUserSession(userId, sessionId);
  await logAudit({
    eventType: 'account.session.revoked',
    resourceType: 'user',
    resourceId: userId,
    details: { session_id: sessionId },
  });
  return session;
}
