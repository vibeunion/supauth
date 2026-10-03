
import { capabilityUnavailable } from '../utils/api-contract.js';
import { hostedContract } from '../utils/hosted-contract.js';
import { defineHttpOperation, defineHttpOperations } from '../http/operation.js';

function legacyAccountRouteUnavailable(): never {
  throw capabilityUnavailable(
    'gotrue_bearer_account_self_service',
    'Use the Bearer-authenticated /v1/public/account endpoints for account self-service.',
  );
}

const hiddenRoute = hostedContract('retired', { hide: true });

export const myAccountRoutes = defineHttpOperations({ prefix: '/v1/my-account' }, {
  getProfile: defineHttpOperation('GET', '/profile', legacyAccountRouteUnavailable, hiddenRoute),
  patchProfile: defineHttpOperation('PATCH', '/profile', legacyAccountRouteUnavailable, hiddenRoute),
  getSessions: defineHttpOperation('GET', '/sessions', legacyAccountRouteUnavailable, hiddenRoute),
  postSessionsBySessionIdRevoke: defineHttpOperation('POST', '/sessions/:sessionId/revoke', legacyAccountRouteUnavailable, hiddenRoute),
  deleteIdentitiesByIdentityId: defineHttpOperation('DELETE', '/identities/:identityId', legacyAccountRouteUnavailable, hiddenRoute),
  getGrants: defineHttpOperation('GET', '/grants', legacyAccountRouteUnavailable, hiddenRoute),
  deleteGrantsByClientId: defineHttpOperation('DELETE', '/grants/:clientId', legacyAccountRouteUnavailable, hiddenRoute),
});
