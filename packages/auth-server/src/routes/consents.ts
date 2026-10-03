
import { capabilityUnavailable } from '../utils/api-contract.js';
import { hostedContract } from '../utils/hosted-contract.js';
import { defineHttpOperation, defineHttpOperations } from '../http/operation.js';

function adminGrantRouteUnavailable(): never {
  throw capabilityUnavailable(
    'gotrue_admin_oauth_grants',
    'Stock GoTrue exposes OAuth grants only to the authenticated user.',
  );
}

const hiddenRoute = hostedContract('retired', { hide: true });

export const consentRoutes = defineHttpOperations({ prefix: '/v1/consents' }, {
  getRoot: defineHttpOperation('GET', '/', adminGrantRouteUnavailable, hiddenRoute),
  getCheck: defineHttpOperation('GET', '/check', adminGrantRouteUnavailable, hiddenRoute),
  postDecision: defineHttpOperation('POST', '/decision', adminGrantRouteUnavailable, hiddenRoute),
  deleteRoot: defineHttpOperation('DELETE', '/', adminGrantRouteUnavailable, hiddenRoute),
  getApplicationByApplicationId: defineHttpOperation('GET', '/application/:applicationId', adminGrantRouteUnavailable, hiddenRoute),
  getUserByUserIdAll: defineHttpOperation('GET', '/user/:userId/all', adminGrantRouteUnavailable, hiddenRoute),
});
