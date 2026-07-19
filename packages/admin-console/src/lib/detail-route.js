import { resolve } from "$app/paths";
import { error, redirect } from "@sveltejs/kit";

export function createDetailRouteRedirect(resourcePath, idParam, defaultTab) {
  return ({ params, url }) => {
    const resourceId = idParam ? `/${encodeURIComponent(params[idParam])}` : "";
    const query = new URLSearchParams(url.searchParams);
    query.delete("tab");
    const suffix = query.toString() ? `?${query}` : "";
    redirect(
      307,
      `${resolve(`${resourcePath}${resourceId}/${defaultTab}`)}${suffix}`,
    );
  };
}

export function createDetailTabGuard(allowedTabs) {
  const allowed = new Set(allowedTabs);
  return ({ params }) => {
    if (!allowed.has(params.tab)) error(404, "Detail tab not found");
  };
}
