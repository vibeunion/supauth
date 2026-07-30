// Supabase Auth Hooks bridge.
// HTTP endpoints call these helpers to keep hook behavior deterministic and testable.

const SUPABASE_RUNTIME_ROLES = ['anon', 'authenticated', 'service_role'] as const;
const SUPAOAUTH_APP_METADATA_SCHEMA_VERSION = 2 as const;
const SUPAOAUTH_PROJECT_PROJECTION_BYTE_LIMIT = 16 * 1024;
const SUPAOAUTH_NAMESPACE_PROJECTION_BYTE_LIMIT = 64 * 1024;
const SUPAOAUTH_ORGANIZATION_MEMBERSHIP_LIMIT = 50;
const SUPAOAUTH_ORGANIZATION_MEMBERSHIP_FIELD_LENGTH_LIMIT = 128;
const APPLICATION_PERMISSION_FIELDS = [
  'roles',
  'roles_count',
  'roles_truncated',
  'roles_projection_limit',
  'permissions',
  'permissions_count',
  'permissions_truncated',
  'permissions_projection_limit',
  'scopes',
  'scopes_count',
  'organization_ids',
  'organization_ids_count',
  'organizations',
  'organizations_count',
] as const;
const utf8Encoder = new TextEncoder();

export interface AuthHookError {
  error: {
    http_code: number;
    message: string;
    code?: string;
  };
}

export interface BeforeUserCreatedPayload {
  user?: {
    email?: string | null;
    phone?: string | null;
    app_metadata?: Record<string, unknown> | null;
    user_metadata?: Record<string, unknown> | null;
  };
  metadata?: Record<string, unknown>;
}

export interface SignupPolicy {
  allowed_email_domains?: string[];
  blocked_email_domains?: string[];
  blocked_oauth_providers?: string[];
  allowed_oauth_providers?: string[];
  invite_only?: boolean;
}

export interface SignupContext {
  invitation_verified?: boolean;
}

export interface CustomAccessTokenPayload {
  user_id?: string;
  claims?: Record<string, unknown>;
  authentication_method?: string;
}

export interface OrganizationMembershipClaims {
  items: Array<{
    organization_id: string;
    slug: string;
    role: string;
  }>;
  total: number;
  truncated: boolean;
}

interface CustomAccessTokenProjectionContext {
  existingContainer: unknown;
  organizationMemberships: OrganizationMembershipClaims;
  projectRef: string;
  authenticationMethod: string;
  applicationId?: string;
}

function normalizeDomain(domain: string): string {
  return domain.trim().replace(/^@/, '').toLowerCase();
}

function getEmailDomain(email?: string | null): string | null {
  if (!email || !email.includes('@')) return null;
  return normalizeDomain(email.split('@').pop() || '');
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function getOAuthProvider(payload: BeforeUserCreatedPayload): string | null {
  const metadata = payload.user?.app_metadata || {};
  const provider = metadata.provider;
  if (typeof provider === 'string') return provider;
  const providers = asStringArray(metadata.providers);
  return providers[0] || null;
}

function reject(httpCode: number, message: string, code?: string): AuthHookError {
  return { error: { http_code: httpCode, message, ...(code ? { code } : {}) } };
}

export function handleBeforeUserCreated(
  payload: BeforeUserCreatedPayload,
  policy: SignupPolicy = {},
  context: SignupContext = {},
): Record<string, never> | AuthHookError {
  const emailDomain = getEmailDomain(payload.user?.email);
  const allowedDomains = (policy.allowed_email_domains || []).map(normalizeDomain).filter(Boolean);
  const blockedDomains = (policy.blocked_email_domains || []).map(normalizeDomain).filter(Boolean);

  if (emailDomain && blockedDomains.includes(emailDomain)) {
    return reject(400, 'Email domain is not allowed to sign up.', 'email_domain_blocked');
  }

  if (allowedDomains.length > 0 && (!emailDomain || !allowedDomains.includes(emailDomain))) {
    return reject(400, 'Only approved email domains are allowed to sign up.', 'email_domain_not_allowed');
  }

  const provider = getOAuthProvider(payload);
  const blockedProviders = (policy.blocked_oauth_providers || []).map(v => v.toLowerCase());
  const allowedProviders = (policy.allowed_oauth_providers || []).map(v => v.toLowerCase());

  if (provider && blockedProviders.includes(provider.toLowerCase())) {
    return reject(400, 'OAuth provider is not allowed for sign up.', 'oauth_provider_blocked');
  }

  if (provider && allowedProviders.length > 0 && !allowedProviders.includes(provider.toLowerCase())) {
    return reject(400, 'OAuth provider is not enabled for sign up.', 'oauth_provider_not_allowed');
  }

  if (policy.invite_only && context.invitation_verified !== true) {
    return reject(403, 'An invitation is required to sign up.', 'invitation_required');
  }

  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const AUTH_HOOK_TOP_LEVEL_SUPAOAUTH_CLAIM_KEYS = [
  'supaoauth',
  'supaoauth:roles',
  'supaoauth:org_id',
  'supaoauth:org_role',
  'supaoauth:scopes',
  'supaoauth:permissions',
] as const;

function removeTopLevelSupaOAuthClaims(claims: Record<string, unknown>): Record<string, unknown> {
  const next = { ...claims };
  for (const claim of AUTH_HOOK_TOP_LEVEL_SUPAOAUTH_CLAIM_KEYS) {
    delete next[claim];
  }
  return next;
}

function schemaV2Projects(container: unknown): Record<string, unknown> {
  if (!isRecord(container) || container.schema_version !== SUPAOAUTH_APP_METADATA_SCHEMA_VERSION) return {};
  return isRecord(container.projects) ? container.projects : {};
}

function projectProjection(projects: Record<string, unknown>, projectRef: string): Record<string, unknown> {
  if (!Object.hasOwn(projects, projectRef)) return {};
  const projection = projects[projectRef];
  return isRecord(projection) ? projection : {};
}

function permissionProjectionFields(permissionSource: Record<string, unknown>) {
  const projectedFields: Record<string, unknown> = {};
  for (const field of APPLICATION_PERMISSION_FIELDS) {
    if (Object.hasOwn(permissionSource, field)) projectedFields[field] = permissionSource[field];
  }
  return projectedFields;
}

function projectForOAuthClient(currentProject: Record<string, unknown>, applicationId: string) {
  if (currentProject.projection_unavailable === true) return currentProject;
  const applications = isRecord(currentProject.applications) ? currentProject.applications : {};
  const application = isRecord(applications[applicationId]) ? applications[applicationId] : null;
  const permissionSource = application || currentProject;
  const nextProject: Record<string, unknown> = { ...currentProject, application_id: applicationId };
  delete nextProject.applications;
  delete nextProject.applications_count;
  for (const field of APPLICATION_PERMISSION_FIELDS) delete nextProject[field];
  return Object.assign(nextProject, permissionProjectionFields(permissionSource));
}

function projectWithOrganizations(
  currentProject: Record<string, unknown>,
  organizationMemberships: OrganizationMembershipClaims,
) {
  return {
    ...currentProject,
    organization_memberships: organizationMemberships.items,
    organization_memberships_total: organizationMemberships.total,
    organization_memberships_truncated: organizationMemberships.truncated,
  };
}

function membershipFieldValid(field: string): boolean {
  return field.trim().length > 0 && field.length <= SUPAOAUTH_ORGANIZATION_MEMBERSHIP_FIELD_LENGTH_LIMIT;
}

function organizationMembershipsValid(memberships: OrganizationMembershipClaims): boolean {
  if (memberships.items.length > SUPAOAUTH_ORGANIZATION_MEMBERSHIP_LIMIT) return false;
  if (!Number.isInteger(memberships.total) || memberships.total < memberships.items.length) return false;
  if (memberships.truncated !== (memberships.total > memberships.items.length)) return false;
  return memberships.items.every((membership) => (
    membershipFieldValid(membership.organization_id)
    && membershipFieldValid(membership.slug)
    && membershipFieldValid(membership.role)
  ));
}

function withinProjectProjectionBudget(projectProjection: Record<string, unknown>): boolean {
  return utf8Encoder.encode(JSON.stringify(projectProjection)).byteLength <= SUPAOAUTH_PROJECT_PROJECTION_BYTE_LIMIT;
}

function withinNamespaceProjectionBudget(supaoauth: Record<string, unknown>): boolean {
  return utf8Encoder.encode(JSON.stringify(supaoauth)).byteLength <= SUPAOAUTH_NAMESPACE_PROJECTION_BYTE_LIMIT;
}

function projectWithSafeMemberships(
  currentProject: Record<string, unknown>,
  organizationMemberships: OrganizationMembershipClaims,
): Record<string, unknown> | null {
  if (currentProject.projection_unavailable === true) {
    return withinProjectProjectionBudget(currentProject) ? currentProject : null;
  }
  if (!organizationMembershipsValid(organizationMemberships)) return null;
  const nextProject = projectWithOrganizations(currentProject, organizationMemberships);
  return withinProjectProjectionBudget(nextProject) ? nextProject : null;
}

function hookMetadata(authenticationMethod: string) {
  return {
    version: 1,
    authentication_method: authenticationMethod,
    processed_at: new Date().toISOString(),
  };
}

function customAccessTokenSupaoauth(context: CustomAccessTokenProjectionContext) {
  const existingProjects = schemaV2Projects(context.existingContainer);
  const currentProject = projectProjection(existingProjects, context.projectRef);
  const projectWithMemberships = projectWithSafeMemberships(currentProject, context.organizationMemberships);
  if (!projectWithMemberships) return null;
  const nextProject = context.applicationId
    ? projectForOAuthClient(projectWithMemberships, context.applicationId)
    : projectWithMemberships;
  const nextSupaoauth = {
    schema_version: SUPAOAUTH_APP_METADATA_SCHEMA_VERSION,
    projects: {
      ...existingProjects,
      [context.projectRef]: nextProject,
    },
    hook: hookMetadata(context.authenticationMethod),
  };
  return withinNamespaceProjectionBudget(nextSupaoauth) ? nextSupaoauth : null;
}

function customAccessTokenInputError(
  claims: Record<string, unknown>,
  projectRef: string,
): AuthHookError | null {
  if (!projectRef) {
    return reject(500, 'The project claim context is not configured.', 'invalid_project_claim_context');
  }
  if (claims.role !== undefined && !SUPABASE_RUNTIME_ROLES.some((runtimeRole) => runtimeRole === claims.role)) {
    return reject(400, 'The top-level Supabase role claim is invalid.', 'invalid_supabase_role');
  }
  if (claims.client_id !== undefined
    && (typeof claims.client_id !== 'string' || !claims.client_id.trim() || claims.client_id.length > 255)) {
    return reject(400, 'The OAuth client_id claim is invalid.', 'invalid_oauth_client_id');
  }
  return null;
}

function customAccessTokenOutput(
  claims: Record<string, unknown>,
  appMetadata: Record<string, unknown>,
  supaoauth: Record<string, unknown>,
) {
  return {
    claims: {
      ...claims,
      app_metadata: { ...appMetadata, supaoauth },
    },
  };
}

export function handleCustomAccessToken(
  payload: CustomAccessTokenPayload,
  organizationMemberships: OrganizationMembershipClaims,
  projectRef: string,
): { claims: Record<string, unknown> } | AuthHookError {
  const claims = removeTopLevelSupaOAuthClaims(isRecord(payload.claims) ? payload.claims : {});
  const inputError = customAccessTokenInputError(claims, projectRef);
  if (inputError) return inputError;
  const appMetadata = isRecord(claims.app_metadata) ? claims.app_metadata : {};
  const supaoauth = customAccessTokenSupaoauth({
    existingContainer: appMetadata.supaoauth,
    organizationMemberships,
    projectRef,
    authenticationMethod: payload.authentication_method || 'unknown',
    applicationId: typeof claims.client_id === 'string' ? claims.client_id : undefined,
  });
  if (!supaoauth) {
    return reject(500, 'The SupaOAuth claim projection exceeds its safe bounds.', 'claim_projection_overflow');
  }
  return customAccessTokenOutput(claims, appMetadata, supaoauth);
}

export function buildHookRegistrationGuide(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, '');
  return {
    before_user_created: `${normalized}/v1/auth-hooks/before-user-created`,
    custom_access_token: `${normalized}/v1/auth-hooks/custom-access-token`,
    protocol: 'standard-webhooks-v1',
    required_headers: ['webhook-id', 'webhook-timestamp', 'webhook-signature'],
    secret_format: 'v1,whsec_<base64>',
  };
}
