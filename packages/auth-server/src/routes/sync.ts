import { Elysia } from 'elysia';
import { capabilityUnavailable } from '../utils/api-contract.js';

export const syncRoutes = new Elysia({ prefix: '/v1/sync' })
  .post('/user/:userId', () => {
    throw capabilityUnavailable(
      'supacloud_rbac_metadata_sync',
      'RBAC metadata is synchronized by the authoritative SupaCloud control plane',
    );
  }, {
    detail: { hide: true },
  })
  .post('/org/:orgId', () => {
    throw capabilityUnavailable(
      'supacloud_rbac_metadata_sync',
      'RBAC metadata is synchronized by the authoritative SupaCloud control plane',
    );
  }, {
    detail: { hide: true },
  });
