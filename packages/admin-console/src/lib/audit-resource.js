const AUDIT_RESOURCE_ROUTES = {
  application: ["applications", "settings"],
  user: ["users", "settings"],
  organization: ["organizations", "settings"],
  role: ["roles", "general"],
  webhook: ["webhooks", "settings"],
  resource: ["api-resources", "general"],
  api_resource: ["api-resources", "general"],
};

export function auditResourcePath(entry) {
  const resourceType = entry?.resource_type || entry?.resourceType;
  const resourceId = entry?.resource_id || entry?.resourceId;
  const route = AUDIT_RESOURCE_ROUTES[resourceType];
  if (!route || typeof resourceId !== "string" || !resourceId) return null;
  return `/${route[0]}/${encodeURIComponent(resourceId)}/${route[1]}`;
}
