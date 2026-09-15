import { Elysia } from 'elysia';
import { capabilityUnavailable } from '../utils/api-contract.js';
import { hostedContract } from '../utils/hosted-contract.js';

function legacyAccountRouteUnavailable(): never {
  throw capabilityUnavailable(
    'gotrue_bearer_account_self_service',
    'Use the Bearer-authenticated /v1/public/account endpoints for account self-service.',
  );
}

const hiddenRoute = hostedContract('retired', { hide: true });

export const myAccountRoutes = new Elysia({ prefix: '/v1/my-account' })
  .get('/profile', legacyAccountRouteUnavailable, hiddenRoute)
  .patch('/profile', legacyAccountRouteUnavailable, hiddenRoute)
  .get('/sessions', legacyAccountRouteUnavailable, hiddenRoute)
  .post('/sessions/:sessionId/revoke', legacyAccountRouteUnavailable, hiddenRoute)
  .delete('/identities/:identityId', legacyAccountRouteUnavailable, hiddenRoute)
  .get('/grants', legacyAccountRouteUnavailable, hiddenRoute)
  .delete('/grants/:clientId', legacyAccountRouteUnavailable, hiddenRoute);
