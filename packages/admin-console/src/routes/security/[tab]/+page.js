import { createDetailTabGuard } from '$lib/detail-route.js';

export const ssr = false;
export const load = createDetailTabGuard(['password', 'captcha', 'blocklist', 'general']);
