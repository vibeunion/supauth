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

export function pagedResponse<T>(
  upstream: unknown,
  pagination: { page?: unknown; limit?: unknown } = {},
): PagedResponse<T> {
  const page = positiveInteger(pagination.page, 1);
  const limit = positiveInteger(pagination.limit, 50);
  if (Array.isArray(upstream)) return { items: upstream as T[], total: upstream.length, page, limit };

  const collection = collectionFrom(upstream);
  if (!collection) {
    throw new ApiContractError(502, 'invalid_upstream_response', 'Upstream collection response has an invalid shape');
  }

  const record = upstream as Record<string, unknown>;
  return {
    items: collection.items as T[],
    total: numericField(record.total) ?? collection.total ?? collection.items.length,
    page: numericField(record.page) ?? page,
    limit: numericField(record.limit) ?? limit,
  };
}

function collectionFrom(upstream: unknown): { items: unknown[]; total?: number } | null {
  if (!upstream || typeof upstream !== 'object') return null;
  const record = upstream as Record<string, unknown>;
  for (const key of COLLECTION_KEYS) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return { items: candidate };
    if (candidate && typeof candidate === 'object') {
      const nested = candidate as Record<string, unknown>;
      if (Array.isArray(nested.items)) return { items: nested.items, total: numericField(nested.total) };
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

export function cursorResponse<T>(
  upstream: unknown,
  pagination: { limit?: unknown } = {},
): CursorResponse<T> {
  const page = pagedResponse<T>(upstream, { limit: pagination.limit });
  const record = upstream && typeof upstream === 'object' ? upstream as Record<string, unknown> : {};
  return {
    items: page.items,
    total: page.total,
    limit: page.limit,
    next_cursor: typeof record.next_cursor === 'string' ? record.next_cursor : null,
  };
}
