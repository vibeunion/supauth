export interface PagedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface CursorResponse<T> {
  items: T[];
  total: number;
  limit: number;
  next_cursor: string | null;
}

const COLLECTION_KEYS = ['items', 'data', 'clients', 'oauth_clients', 'applications', 'users', 'secrets'] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class ApiContractError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiContractError';
  }
}

export function positiveInteger(input: unknown, fallback: number): number {
  const parsed = typeof input === 'string' || typeof input === 'number' ? Number(input) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function pagedResponse(
  upstream: unknown,
  pagination: { page?: unknown; limit?: unknown } = {},
): PagedResponse<unknown> {
  const page = positiveInteger(pagination.page, 1);
  const limit = positiveInteger(pagination.limit, 50);
  if (Array.isArray(upstream)) return { items: upstream, total: upstream.length, page, limit };

  const collection = collectionFrom(upstream);
  if (!collection || !isRecord(upstream)) {
    throw new ApiContractError(502, 'invalid_upstream_response', 'Upstream collection response has an invalid shape');
  }

  const record = upstream;
  return {
    items: collection.items,
    total: numericField(record["total"]) ?? collection.total ?? collection.items.length,
    page: numericField(record["page"]) ?? page,
    limit: numericField(record["limit"]) ?? limit,
  };
}

function collectionFrom(upstream: unknown): { items: unknown[]; total?: number } | null {
  if (!isRecord(upstream)) return null;
  const record = upstream;
  for (const key of COLLECTION_KEYS) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return { items: candidate };
    if (isRecord(candidate)) {
      const nested = candidate;
      if (Array.isArray(nested["items"])) {
        const total = numericField(nested["total"]);
        return { items: nested["items"], ...(total === undefined ? {} : { total }) };
      }
    }
  }
  return null;
}

function numericField(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) ? input : undefined;
}

export function capabilityUnavailable(capability: string, message?: string): ApiContractError {
  return new ApiContractError(
    501,
    'capability_unavailable',
    message || `Required capability is unavailable: ${capability}`,
    { capability },
  );
}

export function cursorResponse(
  upstream: unknown,
  pagination: { limit?: unknown } = {},
): CursorResponse<unknown> {
  const page = pagedResponse(upstream, { limit: pagination.limit });
  const record = isRecord(upstream) ? upstream : {};
  return {
    items: page.items,
    total: page.total,
    limit: page.limit,
    next_cursor: typeof record["next_cursor"] === 'string' ? record["next_cursor"] : null,
  };
}
