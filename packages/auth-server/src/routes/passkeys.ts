// Passkey management routes (P1-9) with OpenAPI annotations

import { Elysia } from 'elysia';
import * as passkeyRepo from '../repositories/passkeys.js';
import * as auditRepo from '../repositories/audit.js';

async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  try { await auditRepo.logAudit({ eventType, resourceType, resourceId, actorType: 'admin', details }); } catch {}
}

export const passkeyRoutes = new Elysia({ prefix: '/v1/passkeys' })
  .get('/:userId', async ({ params }) => {
    const items = await passkeyRepo.listUserPasskeys(params.userId);
    return { items, total: items.length };
  }, {
    detail: { summary: 'List passkeys for a user', tags: ['Passkeys'] },
  })

  .post('/', async ({ body }) => {
    const data = body as { user_id: string; credential_id: string; public_key: string; counter?: number; device_type?: string; backed_up?: boolean; name?: string; transports?: string[] };
    const passkey = await passkeyRepo.registerPasskey({
      userId: data.user_id,
      credentialId: data.credential_id,
      publicKey: data.public_key,
      counter: data.counter,
      deviceType: data.device_type,
      backedUp: data.backed_up,
      name: data.name,
      transports: data.transports,
    });
    await audit('passkey.register', 'passkey', passkey.id, { user_id: data.user_id });
    return passkey;
  }, {
    detail: { summary: 'Register a new passkey', tags: ['Passkeys'] },
  })

  .put('/:passkeyId/rename', async ({ params, body }) => {
    const data = body as { name: string };
    const updated = await passkeyRepo.renamePasskey(params.passkeyId, data.name);
    return updated;
  }, {
    detail: { summary: 'Rename a passkey', tags: ['Passkeys'] },
  })

  .delete('/:passkeyId', async ({ params }) => {
    await passkeyRepo.revokePasskey(params.passkeyId);
    await audit('passkey.revoke', 'passkey', params.passkeyId);
    return { deleted: true };
  }, {
    detail: { summary: 'Revoke (delete) a passkey', tags: ['Passkeys'] },
  });
