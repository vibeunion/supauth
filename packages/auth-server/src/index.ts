// SupAuth Function app — compiled application services for SupaCloud Functions.
// This module must not bind a port. SupaCloud owns all HTTP invocation.

import { createCompiledModules } from '../generated/application.js';
import { createCompiledRuntime } from './compiled-runtime.js';
import { createSupAuthHttpApplication } from './http-application.js';
import { generateRequestId } from './middleware/index.js';
import { withRequestContext } from './auth/request-context.js';

const modules = createCompiledModules();
const runtime = createCompiledRuntime(modules);
const app = await runtime.resolve(services => createSupAuthHttpApplication(modules, services));
export const ready = runtime.ready;
export const close = runtime.close;

export function handleSupAuthRequest(request: Request): Promise<Response> {
  return runtime.run(() => {
    const requestId = request.headers.get('x-request-id') || generateRequestId();
    request.headers.set('x-request-id', requestId);
    return withRequestContext({ requestId }, () => app.handle(request));
  });
}

// Export the app for OpenAPI spec extraction (used by scripts/export-openapi.ts)
export { app };
