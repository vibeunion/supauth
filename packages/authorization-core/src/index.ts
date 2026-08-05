const PERMISSION_PATTERN = /^[a-z][a-z0-9._-]*:[a-z][a-z0-9._-]*$/;
const CONTEXT_PART_PATTERN = /^[^\s]{1,512}$/u;

export type PrincipalKind = 'user' | 'service';
export type Permission = string & { readonly __permission: unique symbol };

export interface AuthorizationPrincipal {
  readonly kind: PrincipalKind;
  readonly issuer: string;
  readonly subject: string;
}

export interface AuthorizationDomain {
  readonly type: string;
  readonly id: string;
}

export interface AuthorizationRequest {
  readonly principal: AuthorizationPrincipal;
  readonly applicationId: string;
  readonly domain: AuthorizationDomain;
}

export interface AuthorizationContext extends AuthorizationRequest {
  permissions: readonly Permission[];
}

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly reason: 'granted' | 'missing_permission';
  readonly permission: Permission;
}

export type AuthorizationResolver = (request: AuthorizationRequest) => Promise<readonly string[]>;

export class AuthorizationUnavailableError extends Error {
  readonly code = 'authorization_unavailable';
  readonly status = 503;

  constructor(message = 'Authorization data is unavailable', options?: ErrorOptions) {
    super(message, options);
    this.name = 'AuthorizationUnavailableError';
  }
}

export class AuthorizationForbiddenError extends Error {
  readonly code = 'authorization_forbidden';
  readonly status = 403;
  readonly permission: Permission;

  constructor(permission: Permission) {
    super(`Permission ${permission} is required`);
    this.name = 'AuthorizationForbiddenError';
    this.permission = permission;
  }
}

export function permission(permissionName: string): Permission {
  if (permissionName.length > 512 || !PERMISSION_PATTERN.test(permissionName)) {
    throw new TypeError(`Invalid permission ${JSON.stringify(permissionName)}; expected resource:action`);
  }
  return permissionName as Permission;
}

function assertContextPart(label: string, contextPart: string): void {
  if (!CONTEXT_PART_PATTERN.test(contextPart)) {
    throw new TypeError(`${label} must be a non-empty value without whitespace`);
  }
}

function assertRequest(request: AuthorizationRequest): void {
  if (request.principal.kind !== 'user' && request.principal.kind !== 'service') {
    throw new TypeError('principal.kind must be user or service');
  }
  assertContextPart('principal.issuer', request.principal.issuer);
  assertContextPart('principal.subject', request.principal.subject);
  assertContextPart('applicationId', request.applicationId);
  assertContextPart('domain.type', request.domain.type);
  assertContextPart('domain.id', request.domain.id);
}

function immutableRequest(request: AuthorizationRequest): AuthorizationRequest {
  return Object.freeze({
    principal: Object.freeze({ ...request.principal }),
    applicationId: request.applicationId,
    domain: Object.freeze({ ...request.domain }),
  });
}

function effectivePermissions(resolvedPermissions: readonly string[]): readonly Permission[] {
  if (!Array.isArray(resolvedPermissions)) throw new TypeError('resolved permissions must be an array');
  const parsedPermissions = resolvedPermissions.map(permissionName => {
    if (typeof permissionName !== 'string') throw new TypeError('resolved permission must be a string');
    return permission(permissionName);
  });
  return Object.freeze([...new Set(parsedPermissions)]);
}

function contextFromPermissions(
  request: AuthorizationRequest,
  resolvedPermissions: readonly string[],
): AuthorizationContext {
  return Object.freeze({
    principal: Object.freeze({ ...request.principal }),
    applicationId: request.applicationId,
    domain: Object.freeze({ ...request.domain }),
    permissions: effectivePermissions(resolvedPermissions),
  });
}

async function currentPermissions(
  request: AuthorizationRequest,
  resolver: AuthorizationResolver,
): Promise<readonly string[]> {
  try {
    return await resolver(request);
  } catch (cause) {
    if (cause instanceof AuthorizationUnavailableError) throw cause;
    throw new AuthorizationUnavailableError('Authorization resolver failed', { cause });
  }
}

export async function resolveAuthorization(
  request: AuthorizationRequest,
  resolver: AuthorizationResolver,
): Promise<AuthorizationContext> {
  assertRequest(request);
  const trustedRequest = immutableRequest(request);
  const resolvedPermissions = await currentPermissions(trustedRequest, resolver);
  try {
    return contextFromPermissions(trustedRequest, resolvedPermissions);
  } catch (cause) {
    throw new AuthorizationUnavailableError('Authorization resolver returned an invalid resolution', { cause });
  }
}

export function decide(context: AuthorizationContext, requiredPermission: Permission): AuthorizationDecision {
  const allowed = context.permissions.includes(requiredPermission);
  return { allowed, reason: allowed ? 'granted' : 'missing_permission', permission: requiredPermission };
}

export function can(context: AuthorizationContext, requiredPermission: Permission): boolean {
  return decide(context, requiredPermission).allowed;
}

export function canAny(context: AuthorizationContext, permissions: readonly Permission[]): boolean {
  return permissions.some(requiredPermission => can(context, requiredPermission));
}

export function canAll(context: AuthorizationContext, permissions: readonly Permission[]): boolean {
  return permissions.length > 0 && permissions.every(requiredPermission => can(context, requiredPermission));
}

export function assertCan(context: AuthorizationContext, requiredPermission: Permission): void {
  if (!can(context, requiredPermission)) throw new AuthorizationForbiddenError(requiredPermission);
}
