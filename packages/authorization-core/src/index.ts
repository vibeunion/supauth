const PERMISSION_PATTERN = /^[a-z][a-z0-9._-]*:[a-z][a-z0-9._-]*$/;
const CONTEXT_PART_PATTERN = /^[^\s]{1,512}$/u;

export type PrincipalKind = 'user' | 'service';
export type MembershipState = 'active' | 'missing' | 'inactive' | 'revoked';
export type Permission = string & { readonly __permission: unique symbol };

export interface AuthorizationPrincipal {
  kind: PrincipalKind;
  issuer: string;
  subject: string;
}

export interface AuthorizationDomain {
  type: string;
  id: string;
}

export interface AuthorizationRequest {
  principal: AuthorizationPrincipal;
  applicationId: string;
  domain: AuthorizationDomain;
}

export interface AuthorizationSnapshot extends AuthorizationRequest {
  permissions: readonly string[];
  membershipState: MembershipState;
  resolvedAt: number;
  expiresAt: number;
  policyVersion: string | number;
  assignmentVersion: string | number;
}

export interface AuthorizationContext extends AuthorizationRequest {
  permissions: readonly Permission[];
  membershipState: MembershipState;
  resolvedAt: number;
  expiresAt: number;
  policyVersion: string | number;
  assignmentVersion: string | number;
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason: 'granted' | 'missing_permission' | 'missing_membership' | 'inactive_membership' | 'revoked_membership';
  permission: Permission;
}

export type AuthorizationResolver = (request: AuthorizationRequest) => Promise<AuthorizationSnapshot>;

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
  if (!PERMISSION_PATTERN.test(permissionName)) {
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

function sameRequest(left: AuthorizationRequest, right: AuthorizationRequest): boolean {
  return left.principal.kind === right.principal.kind
    && left.principal.issuer === right.principal.issuer
    && left.principal.subject === right.principal.subject
    && left.applicationId === right.applicationId
    && left.domain.type === right.domain.type
    && left.domain.id === right.domain.id;
}

function contextPermissions(snapshot: AuthorizationSnapshot): readonly Permission[] {
  const parsedPermissions = snapshot.permissions.map(permissionName => {
    if (typeof permissionName !== 'string') throw new TypeError('snapshot permission must be a string');
    return permission(permissionName);
  });
  if (snapshot.membershipState !== 'active') return Object.freeze([]);
  return Object.freeze([...new Set(parsedPermissions)]);
}

function assertVersion(label: string, version: string | number): void {
  const validString = typeof version === 'string' && /^(?:0|[1-9][0-9]*)$/.test(version);
  const validNumber = typeof version === 'number' && Number.isSafeInteger(version) && version >= 0;
  if (!validString && !validNumber) {
    throw new TypeError(`${label} must be a non-negative integer or decimal integer string`);
  }
}

function assertSnapshot(snapshot: AuthorizationSnapshot, currentTime: number): void {
  assertRequest(snapshot);
  if (!['active', 'missing', 'inactive', 'revoked'].includes(snapshot.membershipState)) {
    throw new TypeError('snapshot.membershipState is invalid');
  }
  if (!Number.isFinite(snapshot.resolvedAt) || snapshot.resolvedAt > currentTime) {
    throw new TypeError('snapshot.resolvedAt must be finite and not in the future');
  }
  if (!Number.isFinite(snapshot.expiresAt) || snapshot.expiresAt <= currentTime || snapshot.expiresAt < snapshot.resolvedAt) {
    throw new TypeError('snapshot is stale or has an invalid expiry');
  }
  assertVersion('snapshot.policyVersion', snapshot.policyVersion);
  assertVersion('snapshot.assignmentVersion', snapshot.assignmentVersion);
  if (!Array.isArray(snapshot.permissions)) throw new TypeError('snapshot.permissions must be an array');
}

function contextFromSnapshot(snapshot: AuthorizationSnapshot): AuthorizationContext {
  return Object.freeze({
    principal: Object.freeze({ ...snapshot.principal }),
    applicationId: snapshot.applicationId,
    domain: Object.freeze({ ...snapshot.domain }),
    permissions: contextPermissions(snapshot),
    membershipState: snapshot.membershipState,
    resolvedAt: snapshot.resolvedAt,
    expiresAt: snapshot.expiresAt,
    policyVersion: snapshot.policyVersion,
    assignmentVersion: snapshot.assignmentVersion,
  });
}

async function resolvedSnapshot(
  request: AuthorizationRequest,
  resolver: AuthorizationResolver,
): Promise<AuthorizationSnapshot> {
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
  const snapshot = await resolvedSnapshot(request, resolver);
  try {
    assertSnapshot(snapshot, Date.now());
    if (!sameRequest(request, snapshot)) throw new TypeError('snapshot context does not match the request');
    return contextFromSnapshot(snapshot);
  } catch (cause) {
    throw new AuthorizationUnavailableError('Authorization resolver returned an invalid snapshot', { cause });
  }
}

export function decide(context: AuthorizationContext, requiredPermission: Permission): AuthorizationDecision {
  const allowed = context.membershipState === 'active' && context.permissions.includes(requiredPermission);
  const deniedReason = context.membershipState === 'active'
    ? 'missing_permission'
    : `${context.membershipState}_membership` as const;
  return {
    allowed,
    reason: allowed ? 'granted' : deniedReason,
    permission: requiredPermission,
  };
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
