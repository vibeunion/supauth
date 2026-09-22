import { createSvelteKitRouterProvider } from '@svadmin/sveltekit';
import type { RouterProvider } from '@svadmin/core';
export {
  ADMIN_PERMISSION_APPLICATION_ID,
  ADMIN_PERMISSION_CATALOG_VERSION,
  createAdminPermissionSnapshot,
  registerAdminAccessControl,
  resetAdminAccessControl,
} from './svadmin-permissions.js';

export function createAdminRouterProvider(): RouterProvider {
  return createSvelteKitRouterProvider();
}
