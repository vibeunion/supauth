// Compatibility window for removed Passkey management routes.


import { capabilityUnavailable } from '../utils/api-contract.js';
import { hostedContract } from '../utils/hosted-contract.js';
import { defineHttpOperation, defineHttpOperations } from '../http/operation.js';

export const passkeyRoutes = defineHttpOperations({ prefix: '/v1/passkeys' }, {
  getByUserId: defineHttpOperation('GET', '/:userId', async ({ params }) => {
    throw capabilityUnavailable('gotrue_passkey_ceremony', `Passkey management is unavailable for ${params.userId}`);
  }, hostedContract('retired', { hide: true })),

  putByPasskeyIdRename: defineHttpOperation('PUT', '/:passkeyId/rename', async ({ params }) => {
    throw capabilityUnavailable('gotrue_passkey_ceremony', `Passkey ${params.passkeyId} cannot be renamed`);
  }, hostedContract('retired', { hide: true })),

  deleteByPasskeyId: defineHttpOperation('DELETE', '/:passkeyId', async ({ params }) => {
    throw capabilityUnavailable('gotrue_passkey_ceremony', `Passkey ${params.passkeyId} cannot be revoked`);
  }, hostedContract('retired', { hide: true })),
});
