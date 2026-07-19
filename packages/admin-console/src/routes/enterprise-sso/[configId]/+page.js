import { createDetailRouteRedirect } from "$lib/detail-route.js";

export const ssr = false;
export const load = createDetailRouteRedirect(
  "/enterprise-sso",
  "configId",
  "connection",
);
