// Observability middleware — request ID, structured logs, audit correlation

import { Elysia } from 'elysia';

function generateRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export const observabilityMiddleware = new Elysia({ name: 'observability' })
  .derive(({ request }) => ({
    requestId: (request.headers.get('x-request-id') as string) || generateRequestId(),
    startTime: performance.now(),
  }))
  .onBeforeHandle(({ requestId }) => {
    (globalThis as Record<string, unknown>).__currentRequestId = requestId;
  })
  .onAfterHandle(({ requestId, startTime, request, set }) => {
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
  .onError(({ requestId, startTime, request, error, set }) => {
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
  });

/** Get the current request ID (for use in audit logging) */
export function getCurrentRequestId(): string | undefined {
  return (globalThis as Record<string, unknown>).__currentRequestId as string | undefined;
}
