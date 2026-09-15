// @ts-check
import { AdminApiError } from "./admin-api.js";

/**
 * @typedef {"items" | "data" | "users" | "applications" | "organizations" | "clients" | "events" | "deliveries"} CollectionKey
 * @typedef {{total: number | null, page: number | null, limit: number | null, declared: boolean}} CollectionPagination
 * @typedef {"forbidden" | "not_found" | "unsupported" | "unavailable" | "error"} RequestErrorState
 * @typedef {{generation: number, resourceId: string, tab: string}} ResourceLoadContext
 */
/**
 * @template T
 * @typedef {{[K in CollectionKey]?: T[] | {items: T[]}}} CollectionFields
 */
/**
 * @template T
 * @typedef {T[] | (CollectionFields<T> & {[K in CollectionKey]: {[P in K]: T[] | {items: T[]}}}[CollectionKey])} CollectionPayload
 */
/**
 * @template T
 * @typedef {{items: T[], metadata: Record<string, unknown> | null}} CollectionEnvelope
 */
/**
 * @template T
 * @typedef {{items: T[], total: number, page: number, limit: number, complete: boolean}} CollectionPage
 */
/**
 * @template T
 * @typedef {{items: T[], total: number, limit: number, nextCursor: string | null}} CursorCollectionPage
 */
/**
 * @template Owner
 * @typedef {{readonly generation: number, readonly ownerContext: Owner}} Operation
 */
/**
 * @template Key, Owner
 * @typedef {Operation<Owner> & {readonly key: Key}} KeyedOperation
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object";
}

/** @param {unknown} value @returns {value is unknown[]} */
function isArray(value) {
  return Array.isArray(value);
}

/** @param {unknown} value @param {string} key @returns {unknown} */
function field(value, key) {
  return value === null || value === undefined
    ? undefined
    : Reflect.get(Object(value), key);
}

/** @type {readonly CollectionKey[]} */
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

/** @param {unknown} payload @returns {CollectionEnvelope<unknown>} */
function collectionEnvelope(payload) {
  if (isArray(payload)) return { items: payload, metadata: null };
  if (!isRecord(payload)) {
    throw new AdminApiError(
      "Management API returned an invalid collection payload",
      502,
      "invalid_upstream_response",
      payload,
    );
  }
  for (const key of COLLECTION_KEYS) {
    const candidate = payload[key];
    if (isArray(candidate)) {
      return { items: candidate, metadata: payload };
    }
    if (
      isRecord(candidate) &&
      isArray(candidate["items"])
    ) {
      return {
        items: candidate["items"],
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

/**
 * @template T
 * @overload
 * @param {CollectionPayload<T>} payload
 * @returns {T[]}
 */
/** @overload @param {unknown} payload @returns {unknown[]} */
/** @param {unknown} payload */
export function collectionItems(payload) {
  return collectionEnvelope(payload).items;
}

/** @param {Record<string, unknown> | null} metadata @param {string} field @param {number} minimum */
function collectionInteger(metadata, field, minimum) {
  const candidate = metadata?.[field];
  if (candidate === undefined || candidate === null) return null;
  if (typeof candidate === "number" && Number.isInteger(candidate) && candidate >= minimum) return candidate;
  throw new AdminApiError(
    `Management API returned invalid collection ${field}`,
    502,
    "invalid_upstream_response",
    metadata,
  );
}

/** @param {Record<string, unknown> | null} metadata @returns {CollectionPagination} */
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

/** @param {unknown[]} items @param {number} total @param {CollectionPagination} pagination @param {unknown} metadata */
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

/** @template T @param {CollectionEnvelope<T>} envelope @returns {CollectionPage<T>} */
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

/** @template T @overload @param {CollectionPayload<T>} payload @returns {CollectionPage<T>} */
/** @overload @param {unknown} payload @returns {CollectionPage<unknown>} */
/** @param {unknown} payload @returns {CollectionPage<unknown>} */
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

/** @template T @overload @param {CollectionPayload<T>} payload @returns {T[]} */
/** @overload @param {unknown} payload @returns {unknown[]} */
/** @param {unknown} payload */
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

/** @param {string} message @param {unknown} payload @returns {never} */
function invalidCursorCollection(message, payload) {
  throw new AdminApiError(
    message,
    502,
    "invalid_upstream_response",
    payload,
  );
}

/** @param {Record<string, unknown>} payload @param {string} field @param {number} minimum @returns {number} */
function requiredCursorInteger(payload, field, minimum) {
  if (!Object.hasOwn(payload, field)) {
    invalidCursorCollection(
      `Management API omitted cursor collection ${field}`,
      payload,
    );
  }
  const candidate = payload[field];
  if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < minimum) {
    invalidCursorCollection(
      `Management API returned invalid cursor collection ${field}`,
      payload,
    );
  }
  return candidate;
}

/** @param {Record<string, unknown>} payload @returns {string | null} */
function validatedNextCursor(payload) {
  if (!Object.hasOwn(payload, "next_cursor")) {
    invalidCursorCollection(
      "Management API omitted cursor collection next_cursor",
      payload,
    );
  }
  const nextCursor = payload["next_cursor"];
  if (nextCursor === null) return null;
  if (typeof nextCursor === "string" && nextCursor.length > 0) return nextCursor;
  invalidCursorCollection(
    "Management API returned invalid cursor collection next_cursor",
    payload,
  );
}

/** @param {CursorCollectionPage<unknown>} page @param {unknown} payload */
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

/** @template T @overload @param {{items: T[], total: number, limit: number, next_cursor: string | null}} payload @returns {CursorCollectionPage<T>} */
/** @overload @param {unknown} payload @returns {CursorCollectionPage<unknown>} */
/** @param {unknown} payload @returns {CursorCollectionPage<unknown>} */
export function cursorCollectionPage(payload) {
  if (!isRecord(payload) || isArray(payload)) {
    invalidCursorCollection(
      "Management API returned an invalid cursor collection payload",
      payload,
    );
  }
  if (!Object.hasOwn(payload, "items") || !isArray(payload["items"])) {
    invalidCursorCollection(
      "Management API returned invalid cursor collection items",
      payload,
    );
  }
  const page = {
    items: payload["items"],
    total: requiredCursorInteger(payload, "total", 0),
    limit: requiredCursorInteger(payload, "limit", 1),
    nextCursor: validatedNextCursor(payload),
  };
  validateCursorCollectionReachability(page, payload);
  return page;
}

/** @template T @overload @param {{items: T[], total: number, limit: number, next_cursor: string | null}} payload @returns {T[]} */
/** @overload @param {unknown} payload @returns {unknown[]} */
/** @param {unknown} payload */
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

/** @param {Pick<CollectionPage<unknown>, "items" | "total" | "limit">} page @param {number} requestedPage */
export function emptyCollectionFallbackPage(page, requestedPage) {
  if (page.items.length > 0 || requestedPage <= 1) return null;
  const finalPage = Math.max(1, Math.ceil(page.total / page.limit));
  return finalPage < requestedPage ? finalPage : null;
}

/** @template T, Key @param {T[]} existingEntries @param {T[]} nextEntries @param {(entry: T) => Key} identifyEntry @returns {T[]} */
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

/** @param {unknown} error @returns {RequestErrorState | null} */
export function requestErrorState(error) {
  if (!error) return null;
  const statusCode =
    error instanceof AdminApiError ? error.statusCode : field(error, "statusCode");
  const code = error instanceof AdminApiError ? error.code : field(error, "code");
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

/** @param {unknown} error @returns {string} */
export function errorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Request failed";
}

/** @template {string} Tab @param {unknown} routeTab @param {readonly Tab[]} allowedTabs @param {Tab} fallback @returns {Tab} */
export function tabFromRoute(routeTab, allowedTabs, fallback) {
  return allowedTabs.find((tab) => tab === routeTab) ?? fallback;
}

/** @param {ResourceLoadContext} loadContext @param {ResourceLoadContext} currentContext */
export function isLatestResourceLoad(loadContext, currentContext) {
  return (
    loadContext.generation === currentContext.generation &&
    loadContext.resourceId === currentContext.resourceId &&
    loadContext.tab === currentContext.tab
  );
}

/** @template Owner */
class OperationTracker {
  /** @type {Operation<Owner> | null} */
  #activeOperation = null;
  #generation = 0;
  #updatePending;

  /** @param {(pending: boolean) => void} updatePending */
  constructor(updatePending) {
    this.#updatePending = updatePending;
  }

  /** @template {Owner} Context @param {Context} ownerContext @returns {Operation<Context>} */
  begin(ownerContext) {
    const operation = { generation: (this.#generation += 1), ownerContext };
    this.#activeOperation = operation;
    this.#updatePending(true);
    return operation;
  }

  /** @param {Operation<Owner>} operation */
  isCurrent(operation) {
    return this.#activeOperation === operation;
  }

  invalidate() {
    if (!this.#activeOperation) return false;
    this.#activeOperation = null;
    this.#updatePending(false);
    return true;
  }

  /** @param {Operation<Owner>} operation */
  finish(operation) {
    if (!this.isCurrent(operation)) return false;
    this.#activeOperation = null;
    this.#updatePending(false);
    return true;
  }
}

/** @template [Owner=unknown] @param {(pending: boolean) => void} updatePending @returns {OperationTracker<Owner>} */
export function createOperationTracker(updatePending) {
  return new OperationTracker(updatePending);
}

/** @template Key, Owner */
class LatestRequestTracker {
  /** @type {Map<Key, KeyedOperation<Key, Owner | null>>} */
  #activeRequests = new Map();
  #generation = 0;

  /** @template {Owner} Context @overload @param {Key} key @param {Context} ownerContext @returns {KeyedOperation<Key, Context>} */
  /** @overload @param {Key} key @returns {KeyedOperation<Key, null>} */
  /** @param {Key} key @param {Owner | null} ownerContext */
  begin(key, ownerContext = null) {
    const request = {
      generation: (this.#generation += 1),
      key,
      ownerContext,
    };
    this.#activeRequests.set(key, request);
    return request;
  }

  /** @param {KeyedOperation<Key, Owner | null>} request */
  isCurrent(request) {
    return this.#activeRequests.get(request.key) === request;
  }

  /** @param {Key} key */
  invalidate(key) {
    return this.#activeRequests.delete(key);
  }
}

/** @template [Key=string], [Owner=unknown] @returns {LatestRequestTracker<Key, Owner>} */
export function createLatestRequestTracker() {
  return new LatestRequestTracker();
}

/** @template Key, Owner */
class KeyedSingleFlightTracker {
  /** @type {Map<Key, KeyedOperation<Key, Owner | null>>} */
  #activeOperations = new Map();
  #generation = 0;

  /** @template {Owner} Context @overload @param {Key} key @param {Context} ownerContext @returns {KeyedOperation<Key, Context> | null} */
  /** @overload @param {Key} key @returns {KeyedOperation<Key, null> | null} */
  /** @param {Key} key @param {Owner | null} ownerContext */
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

  /** @param {KeyedOperation<Key, Owner | null>} operation */
  isCurrent(operation) {
    return this.#activeOperations.get(operation.key) === operation;
  }

  /** @param {Key} key */
  isPending(key) {
    return this.#activeOperations.has(key);
  }

  /** @param {KeyedOperation<Key, Owner | null>} operation */
  finish(operation) {
    if (!this.isCurrent(operation)) return false;
    this.#activeOperations.delete(operation.key);
    return true;
  }

  /** @param {Key} key */
  invalidate(key) {
    return this.#activeOperations.delete(key);
  }
}

/** @template [Key=string], [Owner=unknown] @returns {KeyedSingleFlightTracker<Key, Owner>} */
export function createKeyedSingleFlightTracker() {
  return new KeyedSingleFlightTracker();
}

/** @param {unknown} error */
export function mutationOutcomeUnknown(error) {
  return (
    error instanceof TypeError ||
    Number(field(error, "statusCode")) >= 500 ||
    field(error, "code") === "request_timeout" ||
    field(error, "code") === "request_aborted"
  );
}

/** @template T, Id @param {T[]} items @param {Id} ownerResourceId @param {Id} currentResourceId @returns {T[]} */
export function resourceOwnedItems(items, ownerResourceId, currentResourceId) {
  return ownerResourceId === currentResourceId ? items : [];
}

/** @param {unknown} payload @param {string} capabilityName */
export function capabilityAvailable(payload, capabilityName) {
  const capabilities = field(payload, "capabilities") ?? payload;
  const capability = isArray(capabilities)
    ? capabilities.find(
        (entry) =>
          field(entry, "name") === capabilityName || field(entry, "id") === capabilityName,
      )
    : field(capabilities, capabilityName);
  return capability === true || field(capability, "available") === true;
}

/** @param {unknown} application @param {string} capabilityName @param {boolean} fallback */
function applicationCapability(application, capabilityName, fallback) {
  const capabilities = field(application, "capabilities");
  if (isArray(capabilities)) {
    const capability = capabilities.find(
      (entry) => entry === capabilityName || field(entry, "name") === capabilityName,
    );
    return capability === capabilityName || field(capability, "available") === true;
  }
  if (capabilities && Object.hasOwn(Object(capabilities), capabilityName)) {
    const capability = field(capabilities, capabilityName);
    return capability === true || field(capability, "available") === true;
  }
  return fallback;
}

/** @param {{type?: string, application_type?: string, grant_types?: readonly string[], capabilities?: unknown} | null | undefined} application */
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
  return Object.entries(fallbacks)
    .filter(([tabName, fallback]) => applicationCapability(application, tabName, fallback))
    .map(([tabName]) => tabName);
}
