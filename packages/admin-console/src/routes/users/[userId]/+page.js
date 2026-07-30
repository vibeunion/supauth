import { createDetailRouteRedirect } from "$lib/detail-route.js";

export const ssr = false;
export const load = createDetailRouteRedirect("/users", "userId", "settings");
