import { createLegacyRouteRedirect } from '$lib/legacy-route.js';

export const ssr = false;
export const load = createLegacyRouteRedirect('/sign-in-experience/account-center');
