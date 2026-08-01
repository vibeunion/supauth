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

function collectionEnvelope(payload) {
  if (Array.isArray(payload)) return { items: payload, metadata: null };
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
    if (Array.isArray(candidate)) {
      return { items: candidate, metadata: payload };
    }
    if (
      candidate &&
      typeof candidate === "object" &&
      Array.isArray(candidate.items)
    ) {
      return {
        items: candidate.items,
        metadata: { ...payload, ...candidate },
      };
    }
  }
  throw new AdminApiError(
    "Management API returned an unknown collection envelope",
    502,
    "invalid_upstream_response",
    payload,
  );
}

export function collectionItems(payload) {
  return collectionEnvelope(payload).items;
}

function collectionInteger(metadata, field, minimum) {
  const candidate = metadata?.[field];
  if (candidate === undefined || candidate === null) return null;
  if (Number.isInteger(candidate) && candidate >= minimum) return candidate;
  throw new AdminApiError(
    `Management API returned invalid collection ${field}`,
    502,
    "invalid_upstream_response",
    metadata,
  );
}

function collectionPagination(metadata) {
  const total = collectionInteger(metadata, "total", 0);
  const page = collectionInteger(metadata, "page", 1);
  const limit = collectionInteger(metadata, "limit", 1);
  const declared = page !== null || limit !== null;
  if (declared && (total === null || page === null || limit === null)) {
    throw new AdminApiError(
      "Management API returned incomplete collection pagination metadata",
      502,
      "invalid_upstream_response",
      metadata,
    );
  }
  return { total, page, limit, declared };
}

function validateCollectionPage(items, total, pagination, metadata) {
  if (total < items.length) {
    throw new AdminApiError(
      "Management API returned collection total smaller than its item count",
      502,
      "invalid_upstream_response",
      metadata,
    );
  }
  if (total > items.length && !pagination.declared) {
    throw new AdminApiError(
      "Management API returned a partial collection without pagination metadata",
      502,
      "invalid_upstream_response",
      metadata,
    );
  }
}

function collectionPageFromEnvelope(envelope) {
  const pagination = collectionPagination(envelope.metadata);
  const total = pagination.total ?? envelope.items.length;
  validateCollectionPage(envelope.items, total, pagination, envelope.metadata);
  return {
    items: envelope.items,
    total,
    page: pagination.page ?? 1,
    limit: pagination.limit ?? Math.max(envelope.items.length, 1),
    complete: total === envelope.items.length,
  };
}

export function collectionPage(payload) {
  const envelope = collectionEnvelope(payload);
  if (envelope.metadata) return collectionPageFromEnvelope(envelope);
  return {
    items: envelope.items,
    total: envelope.items.length,
    page: 1,
    limit: Math.max(envelope.items.length, 1),
    complete: true,
  };
}

export function completeCollectionItems(payload) {
  const page = collectionPage(payload);
  if (page.complete) return page.items;
  throw new AdminApiError(
    "Management API returned a partial collection where no navigation is available",
    502,
    "incomplete_collection",
    { total: page.total, page: page.page, limit: page.limit },
  );
}

function invalidCursorCollection(message, payload) {
  throw new AdminApiError(
    message,
    502,
    "invalid_upstream_response",
    payload,
  );
}

function requiredCursorInteger(payload, field, minimum) {
  if (!Object.hasOwn(payload, field)) {
    invalidCursorCollection(
      `Management API omitted cursor collection ${field}`,
      payload,
    );
  }
  const candidate = payload[field];
  if (!Number.isSafeInteger(candidate) || candidate < minimum) {
    invalidCursorCollection(
      `Management API returned invalid cursor collection ${field}`,
      payload,
    );
  }
  return candidate;
}

function validatedNextCursor(payload) {
  if (!Object.hasOwn(payload, "next_cursor")) {
    invalidCursorCollection(
      "Management API omitted cursor collection next_cursor",
      payload,
    );
  }
  const nextCursor = payload.next_cursor;
  if (nextCursor === null) return null;
  if (typeof nextCursor === "string" && nextCursor.length > 0) return nextCursor;
  invalidCursorCollection(
    "Management API returned invalid cursor collection next_cursor",
    payload,
  );
}

function validateCursorCollectionReachability(page, payload) {
  if (page.items.length > page.limit || page.total < page.items.length) {
    invalidCursorCollection(
      "Management API returned inconsistent cursor collection counts",
      payload,
    );
  }
  const remainingItems = page.total > page.items.length;
  if (remainingItems !== (page.nextCursor !== null)) {
    invalidCursorCollection(
      "Management API returned inconsistent cursor collection reachability",
      payload,
    );
  }
}

export function cursorCollectionPage(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    invalidCursorCollection(
      "Management API returned an invalid cursor collection payload",
      payload,
    );
  }
  if (!Object.hasOwn(payload, "items") || !Array.isArray(payload.items)) {
    invalidCursorCollection(
      "Management API returned invalid cursor collection items",
      payload,
    );
  }
  const page = {
    items: payload.items,
    total: requiredCursorInteger(payload, "total", 0),
    limit: requiredCursorInteger(payload, "limit", 1),
    nextCursor: validatedNextCursor(payload),
  };
  validateCursorCollectionReachability(page, payload);
  return page;
}

export function completeCursorCollectionItems(payload) {
  const page = cursorCollectionPage(payload);
  if (page.nextCursor === null) return page.items;
  throw new AdminApiError(
    "Management API returned a partial cursor collection where no navigation is available",
    502,
    "incomplete_collection",
    { total: page.total, limit: page.limit, next_cursor: page.nextCursor },
  );
}

export function emptyCollectionFallbackPage(page, requestedPage) {
  if (page.items.length > 0 || requestedPage <= 1) return null;
  const finalPage = Math.max(1, Math.ceil(page.total / page.limit));
  return finalPage < requestedPage ? finalPage : null;
}

export function mergeCollectionPages(
  existingEntries,
  nextEntries,
  identifyEntry,
) {
  const entriesById = new Map(
    existingEntries.map((entry) => [identifyEntry(entry), entry]),
  );
  for (const entry of nextEntries) {
    entriesById.set(identifyEntry(entry), entry);
  }
  return [...entriesById.values()];
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

export function isLatestResourceLoad(loadContext, currentContext) {
  return (
    loadContext.generation === currentContext.generation &&
    loadContext.resourceId === currentContext.resourceId &&
    loadContext.tab === currentContext.tab
  );
}

class OperationTracker {
  #activeOperation = null;
  #generation = 0;
  #updatePending;

  constructor(updatePending) {
    this.#updatePending = updatePending;
  }

  begin(ownerContext) {
    const operation = { generation: (this.#generation += 1), ownerContext };
    this.#activeOperation = operation;
    this.#updatePending(true);
    return operation;
  }

  isCurrent(operation) {
    return this.#activeOperation === operation;
  }

  invalidate() {
    if (!this.#activeOperation) return false;
    this.#activeOperation = null;
    this.#updatePending(false);
    return true;
  }

  finish(operation) {
    if (!this.isCurrent(operation)) return false;
    this.#activeOperation = null;
    this.#updatePending(false);
    return true;
  }
}

export function createOperationTracker(updatePending) {
  return new OperationTracker(updatePending);
}

class LatestRequestTracker {
  #activeRequests = new Map();
  #generation = 0;

  begin(key, ownerContext = null) {
    const request = {
      generation: (this.#generation += 1),
      key,
      ownerContext,
    };
    this.#activeRequests.set(key, request);
    return request;
  }

  isCurrent(request) {
    return this.#activeRequests.get(request.key) === request;
  }

  invalidate(key) {
    return this.#activeRequests.delete(key);
  }
}

export function createLatestRequestTracker() {
  return new LatestRequestTracker();
}

class KeyedSingleFlightTracker {
  #activeOperations = new Map();
  #generation = 0;

  begin(key, ownerContext = null) {
    if (this.#activeOperations.has(key)) return null;
    const operation = {
      generation: (this.#generation += 1),
      key,
      ownerContext,
    };
    this.#activeOperations.set(key, operation);
    return operation;
  }

  isCurrent(operation) {
    return this.#activeOperations.get(operation.key) === operation;
  }

  isPending(key) {
    return this.#activeOperations.has(key);
  }

  finish(operation) {
    if (!this.isCurrent(operation)) return false;
    this.#activeOperations.delete(operation.key);
    return true;
  }

  invalidate(key) {
    return this.#activeOperations.delete(key);
  }
}

export function createKeyedSingleFlightTracker() {
  return new KeyedSingleFlightTracker();
}

export function mutationOutcomeUnknown(error) {
  return (
    error instanceof TypeError ||
    Number(error?.statusCode) >= 500 ||
    error?.code === "request_timeout" ||
    error?.code === "request_aborted"
  );
}

export function resourceOwnedItems(items, ownerResourceId, currentResourceId) {
  return ownerResourceId === currentResourceId ? items : [];
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
