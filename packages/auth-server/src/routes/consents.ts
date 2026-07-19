import { Elysia } from 'elysia';
import { capabilityUnavailable } from '../utils/api-contract.js';

function adminGrantRouteUnavailable(): never {
  throw capabilityUnavailable(
    'gotrue_admin_oauth_grants',
    'Stock GoTrue exposes OAuth grants only to the authenticated user.',
  );
}

const hiddenRoute = { detail: { hide: true } };

export const consentRoutes = new Elysia({ prefix: '/v1/consents' })
  .get('/', adminGrantRouteUnavailable, hiddenRoute)
  .get('/check', adminGrantRouteUnavailable, hiddenRoute)
  .post('/decision', adminGrantRouteUnavailable, hiddenRoute)
  .delete('/', adminGrantRouteUnavailable, hiddenRoute)
  .get('/application/:applicationId', adminGrantRouteUnavailable, hiddenRoute)
  .get('/user/:userId/all', adminGrantRouteUnavailable, hiddenRoute);
