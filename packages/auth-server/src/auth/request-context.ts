import { AsyncLocalStorage } from 'node:async_hooks';
import type { AdminPrincipal } from './admin-permissions.js';

export interface RequestContext {
  requestId: string;
  principal?: AdminPrincipal;
}

export interface AdminRequestContext extends RequestContext {
  principal: AdminPrincipal;
}

const requestStorage = new AsyncLocalStorage<RequestContext>();

export function enterRequestContext(context: RequestContext): void {
  requestStorage.enterWith(context);
}

export function enterAdminRequestContext(context: AdminRequestContext): void {
  const activeContext = requestStorage.getStore();
  if (activeContext && activeContext.requestId === context.requestId) {
    activeContext.principal = context.principal;
    return;
  }
  requestStorage.enterWith(context);
}

function hasPrincipal(context: RequestContext | undefined): context is AdminRequestContext {
  return context?.principal !== undefined;
}

export function currentAdminRequestContext(): AdminRequestContext | undefined {
  const context = requestStorage.getStore();
  return hasPrincipal(context) ? context : undefined;
}

export function getCurrentRequestId(): string | undefined {
  return requestStorage.getStore()?.requestId;
}

export function withRequestContext<T>(
  context: RequestContext,
  operation: () => T,
): T {
  return requestStorage.run(context, operation);
}

export function withAdminRequestContext<T>(
  context: AdminRequestContext,
  operation: () => T,
): T {
  return requestStorage.run(context, operation);
}
