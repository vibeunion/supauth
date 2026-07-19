import { AdminApiError } from "./admin-api.js";

const COLLECTION_KEYS = [
  "items",
  "data",
  "users",
  "applications",
  "organizations",
  "clients",
  "events",
  "deliveries",
];

export function collectionItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") {
    throw new AdminApiError(
      "Management API returned an invalid collection payload",
      502,
      "invalid_upstream_response",
      payload,
    );
  }
  for (const key of COLLECTION_KEYS) {
    const candidate = payload[key];
    if (Array.isArray(candidate)) return candidate;
    if (
      candidate &&
      typeof candidate === "object" &&
      Array.isArray(candidate.items)
    )
      return candidate.items;
  }
  throw new AdminApiError(
    "Management API returned an unknown collection envelope",
    502,
    "invalid_upstream_response",
    payload,
  );
}

export function requestErrorState(error) {
  if (!error) return null;
  const statusCode =
    error instanceof AdminApiError ? error.statusCode : error?.statusCode;
  const code = error instanceof AdminApiError ? error.code : error?.code;
  if (
    statusCode === 403 ||
    code === "insufficient_permissions" ||
    code === "forbidden"
  )
    return "forbidden";
  if (statusCode === 404 || code === "not_found") return "not_found";
  if (
    code === "not_supported" ||
    code === "unsupported" ||
    code === "unsupported_grant_type"
  )
    return "unsupported";
  if (
    statusCode === 501 ||
    statusCode === 503 ||
    statusCode === 502 ||
    code === "capability_unavailable" ||
    code === "upstream_unavailable"
  )
    return "unavailable";
  return "error";
}

export function errorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Request failed";
}

export function tabFromRoute(routeTab, allowedTabs, fallback) {
  return allowedTabs.includes(routeTab) ? routeTab : fallback;
}

export function capabilityAvailable(payload, capabilityName) {
  const capabilities = payload?.capabilities ?? payload;
  const capability = Array.isArray(capabilities)
    ? capabilities.find(
        (entry) =>
          entry?.name === capabilityName || entry?.id === capabilityName,
      )
    : capabilities?.[capabilityName];
  return capability === true || capability?.available === true;
}

function applicationCapability(application, capabilityName, fallback) {
  const capabilities = application?.capabilities;
  if (Array.isArray(capabilities)) {
    const capability = capabilities.find(
      (entry) => entry === capabilityName || entry?.name === capabilityName,
    );
    return capability === capabilityName || capability?.available === true;
  }
  if (capabilities && Object.hasOwn(capabilities, capabilityName)) {
    const capability = capabilities[capabilityName];
    return capability === true || capability?.available === true;
  }
  return fallback;
}

export function applicationDetailTabValues(application) {
  const kind = application?.type || application?.application_type;
  const grants = application?.grant_types || [];
  const machineToMachine =
    kind === "m2m" ||
    (grants.includes("client_credentials") &&
      !grants.includes("authorization_code"));
  const fallbacks = {
    settings: true,
    roles: machineToMachine,
    logs: true,
    branding: !machineToMachine,
    permissions: true,
    rules: !machineToMachine,
    organizations: true,
  };
  return Object.keys(fallbacks).filter((tabName) =>
    applicationCapability(application, tabName, fallbacks[tabName]),
  );
}
