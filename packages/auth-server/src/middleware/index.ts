// Observability middleware — request ID, structured logs, audit correlation

import { Elysia } from 'elysia';
import { enterRequestContext, getCurrentRequestId } from '../auth/request-context.js';
import { SupaCloudApiError } from '../supacloud/adapter.js';
import { ApiContractError } from '../utils/api-contract.js';

export function generateRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export const observabilityMiddleware = new Elysia({ name: 'observability' })
  .derive({ as: 'global' }, ({ request }) => {
    const requestId = request.headers.get('x-request-id') || generateRequestId();
    request.headers.set('x-request-id', requestId);
    if (!getCurrentRequestId()) enterRequestContext({ requestId });
    return { requestId, startTime: performance.now() };
  })
  .onAfterHandle({ as: 'global' }, ({ requestId, startTime, request, set }) => {
    const duration = performance.now() - (startTime ?? 0);
    set.headers['x-request-id'] = requestId;

    if (process.env.LOG_LEVEL === 'debug') {
      console.log(JSON.stringify({
        level: 'info',
        msg: 'request',
        request_id: requestId,
        method: request.method,
        url: request.url,
        duration_ms: Math.round(duration),
      }));
    }
  })
  .onError({ as: 'global' }, ({ requestId, startTime, request, error, set }) => {
    const duration = performance.now() - (startTime ?? 0);
    set.headers['x-request-id'] = requestId;

    console.error(JSON.stringify({
      level: 'error',
      msg: 'request_error',
      request_id: requestId,
      method: request.method,
      url: request.url,
      error: (error as Error).message,
      duration_ms: Math.round(duration),
    }));

    const normalizedError = normalizeApiError(
      error,
      requestId || request.headers.get('x-request-id') || 'unknown',
    );
    if (!normalizedError) return;
    set.status = normalizedError.status;
    return normalizedError.body;
  });

interface NormalizedApiError {
  status: number;
  body: Record<string, unknown>;
}

interface ApiErrorContract {
  status: number;
  code: string;
  message: string;
  correlationId: string;
  details?: Record<string, unknown>;
}

function normalizeApiError(error: unknown, correlationId: string): NormalizedApiError | null {
  if (error instanceof ApiContractError) {
    return errorBody({
      status: error.status,
      code: error.code,
      message: error.message,
      correlationId,
      details: error.details,
    });
  }
  return error instanceof SupaCloudApiError
    ? normalizeSupaCloudApiError(error, correlationId)
    : null;
}

function normalizeSupaCloudApiError(
  error: SupaCloudApiError,
  correlationId: string,
): NormalizedApiError {
  const unavailable = error.status >= 500;
  return errorBody({
    status: error.status === 501 || error.status === 404
      ? error.status
      : unavailable ? 503 : error.status,
    code: error.status === 501
      ? 'capability_unavailable'
      : error.status === 404 ? 'not_found' : 'supacloud_upstream_error',
    message: unavailable ? 'SupaCloud Management API is unavailable' : error.body,
    correlationId,
    details: { path: error.path },
  });
}

function errorBody(contract: ApiErrorContract): NormalizedApiError {
  return {
    status: contract.status,
    body: {
      success: false,
      error: {
        code: contract.code,
        message: contract.message,
        correlation_id: contract.correlationId,
        ...(contract.details ? { details: contract.details } : {}),
      },
    },
  };
}

export { getCurrentRequestId } from '../auth/request-context.js';
