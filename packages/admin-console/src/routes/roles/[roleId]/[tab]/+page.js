import { createDetailTabGuard } from '$lib/detail-route.js';

export const ssr = false;
export const load = createDetailTabGuard(['general', 'permissions', 'users', 'm2m']);
