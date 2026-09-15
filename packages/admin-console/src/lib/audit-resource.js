// @ts-check
/** @type {Readonly<Record<string, readonly [string, string]>>} */
const AUDIT_RESOURCE_ROUTES = {
  application: ["applications", "settings"],
  user: ["users", "settings"],
  organization: ["organizations", "settings"],
  role: ["roles", "general"],
  webhook: ["webhooks", "settings"],
  resource: ["api-resources", "general"],
  api_resource: ["api-resources", "general"],
};

/** @param {unknown} entry */
export function auditResourcePath(entry) {
  if (!entry || typeof entry !== "object") return null;
  const resource_type = "resource_type" in entry ? entry.resource_type : undefined;
  const resource_id = "resource_id" in entry ? entry.resource_id : undefined;
  const resourceType = resource_type || ("resourceType" in entry ? entry.resourceType : undefined);
  const resourceId = resource_id || ("resourceId" in entry ? entry.resourceId : undefined);
  const route = typeof resourceType === "string" && Object.hasOwn(AUDIT_RESOURCE_ROUTES, resourceType)
    ? AUDIT_RESOURCE_ROUTES[resourceType] : undefined;
  if (!route || typeof resourceId !== "string" || !resourceId) return null;
  return `/${route[0]}/${encodeURIComponent(resourceId)}/${route[1]}`;
}
