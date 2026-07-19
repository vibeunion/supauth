import { createDetailTabGuard } from '$lib/detail-route.js';

export const ssr = false;
export const load = createDetailTabGuard(['settings', 'members', 'm2m', 'branding']);
