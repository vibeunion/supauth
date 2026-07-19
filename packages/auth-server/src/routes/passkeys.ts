// Compatibility window for removed Passkey management routes.

import { Elysia } from 'elysia';
import { capabilityUnavailable } from '../utils/api-contract.js';

export const passkeyRoutes = new Elysia({ prefix: '/v1/passkeys' })
  .get('/:userId', async ({ params }) => {
    throw capabilityUnavailable('gotrue_passkey_ceremony', `Passkey management is unavailable for ${params.userId}`);
  }, {
    detail: { hide: true },
  })

  .put('/:passkeyId/rename', async ({ params }) => {
    throw capabilityUnavailable('gotrue_passkey_ceremony', `Passkey ${params.passkeyId} cannot be renamed`);
  }, {
    detail: { hide: true },
  })

  .delete('/:passkeyId', async ({ params }) => {
    throw capabilityUnavailable('gotrue_passkey_ceremony', `Passkey ${params.passkeyId} cannot be revoked`);
  }, {
    detail: { hide: true },
  });
