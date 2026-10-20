import { authorizeAdminRequest } from '../auth/index.js';
import { principalHasAction } from '../auth/admin-permissions.js';
import { currentAdminRequestContext } from '../auth/request-context.js';
import { ApiContractError } from '../utils/api-contract.js';

export async function adminHttpAspect(
  context: { request?: Request },
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  if (!context.request) throw new ApiContractError(401, 'unauthorized', 'Authentication required');
  const denied = await authorizeAdminRequest(context.request);
  return denied ?? await next();
}

export function requireAdminAction(action: string): void {
  const context = currentAdminRequestContext();
  if (!context) throw new ApiContractError(401, 'unauthorized', 'Authentication required');
  if (!principalHasAction(context.principal, action)) {
    throw new ApiContractError(403, 'insufficient_permissions', 'Permission denied', {
      required_action: action,
    });
  }
}
