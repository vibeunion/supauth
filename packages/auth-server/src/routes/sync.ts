
import { capabilityUnavailable } from '../utils/api-contract.js';
import { retiredOperationContract } from '../utils/operation-contract.js';
import { defineHttpOperation, defineHttpOperations } from '../http/operation.js';

export const syncRoutes = defineHttpOperations({ prefix: '/v1/sync' }, {
  postUserByUserId: defineHttpOperation('POST', '/user/:userId', () => {
    throw capabilityUnavailable(
      'supacloud_rbac_metadata_sync',
      'RBAC metadata is synchronized by the authoritative SupaCloud control plane',
    );
  }, retiredOperationContract('sync:user')),
  postOrgByOrgId: defineHttpOperation('POST', '/org/:orgId', () => {
    throw capabilityUnavailable(
      'supacloud_rbac_metadata_sync',
      'RBAC metadata is synchronized by the authoritative SupaCloud control plane',
    );
  }, retiredOperationContract('sync:organization')),
});
