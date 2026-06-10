// Passkey management routes (P1-9) with OpenAPI annotations

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as auditRepo from '../repositories/audit.js';

const adapter = getSupaCloudAdapter();

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  try { await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details }); } catch {}
}

function toListResponse(value: unknown) {
  if (Array.isArray(value)) return { items: value, total: value.length };
  if (value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)) {
    const items = (value as { items: unknown[]; total?: unknown }).items;
    return { items, total: typeof (value as { total?: unknown }).total === 'number' ? (value as { total: number }).total : items.length };
  }
  return { items: [], total: 0 };
}

export const passkeyRoutes = new Elysia({ prefix: '/v1/passkeys' })
  .get('/:userId', async ({ params }) => {
    return toListResponse(await adapter.listUserPasskeys(params.userId));
  }, {
    detail: { summary: 'List passkeys for a user', tags: ['Passkeys'] },
  })

  .post('/', async ({ body }) => {
    const data = body as { user_id: string; credential_id: string; public_key: string; counter?: number; device_type?: string; backed_up?: boolean; name?: string; transports?: string[] };
    const passkey = await adapter.registerUserPasskey(data.user_id, data as Record<string, unknown>);
    const record = passkey as Record<string, unknown>;
    await audit('passkey.register', 'passkey', String(record.id || ''), { user_id: data.user_id });
    return passkey;
  }, {
    detail: { summary: 'Register a new passkey', tags: ['Passkeys'] },
  })

  .put('/:passkeyId/rename', async ({ params, body }) => {
    const data = body as { name: string };
    return adapter.renamePasskey(params.passkeyId, data as Record<string, unknown>);
  }, {
    detail: { summary: 'Rename a passkey', tags: ['Passkeys'] },
  })

  .delete('/:passkeyId', async ({ params }) => {
    await adapter.revokePasskey(params.passkeyId);
    await audit('passkey.revoke', 'passkey', params.passkeyId);
  }, {
    detail: { summary: 'Revoke (delete) a passkey', tags: ['Passkeys'] },
  });
