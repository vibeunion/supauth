import { readAuthorizationRequest, readResolvedPermissions } from './validation.js';

const PERMISSION_PATTERN = /^[a-z][a-z0-9._-]*:[a-z][a-z0-9._-]*$/;

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
  readonly permissionCatalogVersion?: string;
  readonly permissionCatalogDigest?: string;
}

export interface AuthorizationPermissionCatalog {
  readonly applicationId: string;
  readonly version: string;
  readonly digest?: string;
  readonly permissions: readonly string[];
}

export interface AuthorizationResolutionOptions {
  readonly permissionCatalog?: AuthorizationPermissionCatalog;
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
  if (typeof permissionName !== 'string' || permissionName.length > 512 || !PERMISSION_PATTERN.test(permissionName)) {
    throw new TypeError(`Invalid permission ${JSON.stringify(permissionName)}; expected resource:action`);
  }
  // 品牌只在字符串、长度和 resource:action 语法均校验后创建。
  return permissionName as Permission;
}

function immutableRequest(request: AuthorizationRequest): AuthorizationRequest {
  return Object.freeze({
    principal: Object.freeze({ ...request.principal }),
    applicationId: request.applicationId,
    domain: Object.freeze({ ...request.domain }),
  });
}

function effectivePermissions(
  resolvedPermissions: readonly string[],
  catalog?: AuthorizationPermissionCatalog,
): readonly Permission[] {
  const parsedPermissions = readResolvedPermissions(resolvedPermissions).map(permission);
  if (catalog) {
    const allowed = new Set(catalog.permissions.map(permission));
    if (parsedPermissions.some(grant => !allowed.has(grant))) {
      throw new TypeError('resolved permissions are not present in the application permission catalog');
    }
  }
  return Object.freeze([...new Set(parsedPermissions)]);
}

function contextFromPermissions(
  request: AuthorizationRequest,
  resolvedPermissions: readonly string[],
  catalog?: AuthorizationPermissionCatalog,
): AuthorizationContext {
  const permissions = effectivePermissions(resolvedPermissions, catalog);
  return Object.freeze({
    principal: Object.freeze({ ...request.principal }),
    applicationId: request.applicationId,
    domain: Object.freeze({ ...request.domain }),
    permissions,
    ...(catalog ? { permissionCatalogVersion: catalog.version } : {}),
    ...(catalog?.digest === undefined ? {} : { permissionCatalogDigest: catalog.digest }),
  });
}

export function createPermissionCatalog(input: AuthorizationPermissionCatalog): AuthorizationPermissionCatalog {
  const catalog = readPermissionCatalog({
    principal: { kind: 'service', issuer: 'catalog', subject: 'catalog' },
    applicationId: input.applicationId,
    domain: { type: 'catalog', id: input.applicationId },
  }, input);
  if (!catalog) throw new TypeError('invalid application permission catalog');
  return catalog;
}

/** Stable digest for binding claims, runtime adapters, and UI projections to one catalog. */
export async function permissionCatalogDigest(catalog: AuthorizationPermissionCatalog): Promise<string> {
  const normalized = createPermissionCatalog(catalog);
  const payload = JSON.stringify({
    applicationId: normalized.applicationId,
    version: normalized.version,
    permissions: [...normalized.permissions].sort(),
  });
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function readPermissionCatalog(
  request: AuthorizationRequest,
  catalog: AuthorizationPermissionCatalog | undefined,
): AuthorizationPermissionCatalog | undefined {
  if (catalog === undefined) return undefined;
  if (catalog.applicationId !== request.applicationId
      || typeof catalog.version !== 'string'
      || catalog.version.length === 0
      || (catalog.digest !== undefined && !/^[a-f0-9]{64}$/i.test(catalog.digest))
      || !Array.isArray(catalog.permissions)
      || catalog.permissions.length === 0) {
    throw new TypeError('invalid application permission catalog');
  }
  const permissions = catalog.permissions.map(permission);
  if (new Set(permissions).size !== permissions.length) {
    throw new TypeError('application permission catalog contains duplicate permissions');
  }
  return Object.freeze({
    applicationId: catalog.applicationId,
    version: catalog.version,
    ...(catalog.digest === undefined ? {} : { digest: catalog.digest }),
    permissions: Object.freeze([...permissions].sort()),
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
  options: AuthorizationResolutionOptions = {},
): Promise<AuthorizationContext> {
  const trustedRequest = immutableRequest(readAuthorizationRequest(request));
  const catalog = readPermissionCatalog(trustedRequest, options.permissionCatalog);
  const resolvedPermissions = await currentPermissions(trustedRequest, resolver);
  try {
    return contextFromPermissions(trustedRequest, resolvedPermissions, catalog);
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
