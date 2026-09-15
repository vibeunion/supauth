import { base } from "$app/paths";
import { error, redirect } from "@sveltejs/kit";
import { resolveConsolePath } from "./navigation.js";

/**
 * @param {string} resourcePath
 * @param {string | null} idParam
 * @param {string} defaultTab
 * @returns {({ params, url }: { params: Record<string, string | undefined>; url: URL }) => never}
 */
export function createDetailRouteRedirect(resourcePath, idParam, defaultTab) {
  return ({ params, url }) => {
    const identifier = idParam ? params[idParam] : undefined;
    if (idParam && !identifier) error(404, "Resource not found");
    const resourceId = identifier ? `/${encodeURIComponent(identifier)}` : "";
    const query = new URLSearchParams(url.searchParams);
    query.delete("tab");
    const suffix = query.toString() ? `?${query}` : "";
    redirect(
      307,
      `${resolveConsolePath(`${resourcePath}${resourceId}/${defaultTab}`, base)}${suffix}`,
    );
  };
}

/**
 * @param {readonly string[]} allowedTabs
 * @returns {({ params }: { params: Record<string, string | undefined> }) => void}
 */
export function createDetailTabGuard(allowedTabs) {
  const allowed = new Set(allowedTabs);
  return ({ params }) => {
    if (!params["tab"] || !allowed.has(params["tab"])) error(404, "Detail tab not found");
  };
}
