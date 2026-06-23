// @supauth/sdk-typescript — TypeScript SDK for SupaOAuth Management API
import type {
  Application,
  CreateApplicationInput,
  ApiResource,
  CreateResourceInput,
  Scope,
  Connector,
  Organization,
  OrganizationMember,
  Role,
  Permission,
  SignInExperience,
  ApplicationSignInExperience,
  EffectiveSignInExperience,
  PublicEffectiveSignInExperience,
  PublicPhraseBundle,
  AuditLogEntry,
  Webhook,
  RuntimeMode,
  CompatibilityCheckResult,
} from '@supauth/shared';

// ─── Response wrappers ──────────────────────────────────
interface ListResponse<T> {
  items: T[];
  total: number;
}

interface HealthResponse {
  status: string;
  runtime_mode: RuntimeMode;
  project_ref: string;
}

interface ProjectResponse {
  id: string;
  name: string;
  region?: string;
  database_url?: string;
}

interface OAuthServerStatus {
  enabled: boolean;
  signing_alg: string;
  allow_dynamic_registration: boolean;
  migration_status?: string;
}

interface DiscoveryResponse {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  [key: string]: unknown;
}

interface JWKSResponse {
  keys: Record<string, unknown>[];
}

interface AuthConfigResponse {
  enable_signup: boolean;
  enable_confirmations: boolean;
  external_anonymous_users_enabled: boolean;
  jwt_expiry: number;
  password_min_length: number;
  mfa_max_enrolled_factors: number;
  [key: string]: unknown;
}

interface ApplicationBinding {
  id: string;
  application_id: string;
  resource_id: string;
  scope_id?: string;
  created_at: string;
}

interface OAuthApplication {
  client_id: string;
  client_name?: string;
  client_type?: string;
  redirect_uris?: string[];
  grant_types?: string[];
  token_endpoint_auth_method?: string;
  client_secret?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

interface RoleAssignment {
  id: string;
  role_id: string;
  user_id: string;
  organization_id?: string;
  application_id?: string;
  created_at: string;
}

interface UserPermissions {
  roles: string[];
  permissions: string[];
  scopes: string[];
}

interface SyncResult {
  synced: boolean;
  warnings?: string[];
}

interface WebhookEventList {
  events: string[];
}

interface WebhookDeliveryLog {
  id?: string;
  event?: string;
  event_type?: string;
  eventType?: string;
  status?: string | number;
  status_code?: number;
  statusCode?: number;
  http_status?: number;
  httpStatus?: number;
  success?: boolean;
  ok?: boolean;
  delivered?: boolean;
  error?: string;
  error_message?: string;
  errorMessage?: string;
  signature_status?: string;
  signatureStatus?: string;
  signature_verified?: boolean;
  signatureVerified?: boolean;
  signature_valid?: boolean;
  signatureValid?: boolean;
  payload?: Record<string, unknown>;
  body?: Record<string, unknown>;
  created_at?: string;
  createdAt?: string;
  delivered_at?: string;
  deliveredAt?: string;
  [key: string]: unknown;
}

interface UserConsent {
  id: string;
  userId?: string;
  user_id?: string;
  applicationId?: string;
  application_id?: string;
  scopeId?: string | null;
  scope_id?: string | null;
  organizationId?: string | null;
  organization_id?: string | null;
  grantedAt?: string;
  granted_at?: string;
  revokedAt?: string | null;
  revoked_at?: string | null;
}

interface OrganizationTemplate {
  id: string;
  name: string;
  description?: string | null;
  templateRoles?: Array<{ name: string; permissions: string[] }>;
  template_roles?: Array<{ name: string; permissions: string[] }>;
  templateScopes?: Array<{ name: string; description?: string }>;
  template_scopes?: Array<{ name: string; description?: string }>;
  isDefault?: boolean;
  is_default?: boolean;
}

interface SecurityStatus {
  admin_auth_mode: string;
  token_auth_allowed: boolean;
  rate_limit_rpm: number;
  brute_force_protection: boolean;
  enforce_https: boolean;
  warnings: string[];
}

interface EnterpriseSSOConfig {
  id: string;
  connectorId?: string;
  connector_id?: string;
  domains: string[];
  ssoProtocol?: string;
  sso_protocol?: string;
  jitProvisioning?: boolean;
  jit_provisioning?: boolean;
  orgMembershipMapping?: Record<string, string>;
  org_membership_mapping?: Record<string, string>;
  roleMapping?: Record<string, string>;
  role_mapping?: Record<string, string>;
}

interface Passkey {
  id: string;
  userId?: string;
  user_id?: string;
  credentialId?: string;
  credential_id?: string;
  name?: string | null;
  createdAt?: string;
  created_at?: string;
  lastUsedAt?: string | null;
  last_used_at?: string | null;
}

interface ApplicationSecret {
  id: string;
  applicationId?: string;
  application_id?: string;
  secretId?: string;
  secret_id?: string;
  name: string;
  status: string;
  expiresAt?: string | null;
  expires_at?: string | null;
  secret?: string;
}

interface ApplicationConsentSettings {
  user_scopes?: string[];
  organization_scopes?: string[];
  allowed_organization_ids?: string[];
  require_explicit_consent?: boolean;
  custom_data?: Record<string, unknown>;
}

type ApplicationSignInExperienceInput = Partial<Omit<ApplicationSignInExperience, 'application_id'>>;

interface OrganizationInvitation {
  id: string;
  email: string;
  role: string;
  status: string;
  token?: string;
}

interface OrganizationJitSettings {
  email_domains?: string[];
  sso_connector_ids?: string[];
  default_role_ids?: string[];
  enabled: boolean;
}

interface ConnectorFactory {
  id: string;
  factoryId?: string;
  factory_id?: string;
  name: string;
  protocol: string;
  category: string;
  configSchema?: Record<string, unknown>;
  config_schema?: Record<string, unknown>;
  enabled: boolean;
}

interface TenantConfig {
  id: string;
  configType?: string;
  config_type?: string;
  key: string;
  value: Record<string, unknown>;
  enabled: boolean;
}

interface AuthHookRegistrationGuide {
  before_user_created: string;
  custom_access_token: string;
  mfa_verification_attempt: string;
  secret_header: string;
  required_env: string;
}

// ─── RLS Migration Assistant types ──────────────────────
export interface ExistingPolicy {
  schemaname: string;
  tablename: string;
  policyname: string;
  policytype: 'permissive' | 'restrictive';
  cmd: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL';
  qual: string | null;
  with_check: string | null;
  roles: string[];
}

export interface WrapperPolicy {
  original_policy: string;
  wrapper_policy_name: string;
  tablename: string;
  schemaname: string;
  cmd: string;
  original_using: string | null;
  original_with_check: string | null;
  wrapper_using: string | null;
  wrapper_with_check: string | null;
  sql: string;
  permission_name: string;
}

export interface MigrationResult {
  scanned_policies: number;
  candidate_policies: number;
  wrappers: WrapperPolicy[];
  migration_sql: string;
  warnings: string[];
}

export type AuthorizationOperation = 'read' | 'create' | 'update' | 'delete' | 'manage';

export interface AuthorizationCompileRequest {
  tables?: Array<{
    schema?: string;
    table: string;
    permission_prefix?: string;
    operations?: AuthorizationOperation[];
    owner_column?: string;
    organization_column?: string;
  }>;
  storage_buckets?: Array<{
    bucket_id: string;
    permission_prefix?: string;
    owner_path_prefix?: string;
    organization_path_prefix?: string;
    operations?: AuthorizationOperation[];
  }>;
  realtime_channels?: Array<{
    topic: string;
    permission: string;
    organization_claim?: string;
  }>;
  edge_functions?: Array<{
    name: string;
    permission: string;
    require_organization?: boolean;
  }>;
  include_helper_sql?: boolean;
}

export interface AuthorizationCompileResult {
  generated_at: string;
  assumptions: string[];
  warnings: string[];
  permissions: string[];
  sql: {
    helpers: string;
    tables: string;
    storage: string;
    realtime: string;
    rollback: string;
  };
  edge_functions: Array<{
    name: string;
    permission: string;
    middleware: string;
    negative_tests: string[];
  }>;
  negative_tests: string[];
  deploy_checklist: string[];
}

// ─── Error class ─────────────────────────────────────────
export class SupaOAuthAPIError extends Error {
  status: number;
  body: string;
  path: string;

  constructor(status: number, body: string, path: string) {
    super(`SupaOAuth API ${status}: ${body}`);
    this.name = 'SupaOAuthAPIError';
    this.status = status;
    this.body = body;
    this.path = path;
  }
}

// ─── Client ──────────────────────────────────────────────
export class SupaOAuthClient {
  private baseUrl: string;
  private accessToken: string | null = null;

  constructor(options: { baseUrl: string; accessToken?: string }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    if (options.accessToken) this.accessToken = options.accessToken;
  }

  /** Set or update the access token (e.g. after login) */
  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  private async request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }
    const res = await fetch(`${this.baseUrl}${path}`, { ...options, headers });
    if (!res.ok) {
      const body = await res.text();
      throw new SupaOAuthAPIError(res.status, body, path);
    }
    if (res.status === 204) return null as T;
    return res.json() as Promise<T>;
  }

  // ─── Health / Project ─────────────────────────────────
  health() {
    return this.request<HealthResponse>('/v1/health');
  }

  getProject() {
    return this.request<ProjectResponse>('/v1/project');
  }

  // ─── Runtime ──────────────────────────────────────────
  getRuntimeHealth() {
    return this.request<{ status: string }>('/v1/runtime/health');
  }

  getOAuthServerStatus() {
    return this.request<OAuthServerStatus>('/v1/runtime/oauth-server');
  }

  getDiscovery() {
    return this.request<DiscoveryResponse>('/v1/runtime/discovery');
  }

  getJWKS() {
    return this.request<JWKSResponse>('/v1/runtime/jwks');
  }

  // ─── Applications ──────────────────────────────────────
  listApplications() {
    return this.request<ListResponse<OAuthApplication>>('/v1/applications');
  }

  createApplication(data: CreateApplicationInput) {
    return this.request<Application>('/v1/applications', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  getApplication(appId: string) {
    return this.request<Application>(`/v1/applications/${appId}`);
  }

  updateApplication(appId: string, data: Partial<CreateApplicationInput>) {
    return this.request<Application>(`/v1/applications/${appId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  deleteApplication(appId: string) {
    return this.request<void>(`/v1/applications/${appId}`, { method: 'DELETE' });
  }

  rotateApplicationSecret(appId: string) {
    return this.request<Application & { client_secret: string }>(
      `/v1/applications/${appId}/rotate-secret`,
      { method: 'POST' },
    );
  }

  listApplicationSecrets(appId: string) {
    return this.request<ListResponse<ApplicationSecret>>(`/v1/applications/${appId}/secrets`);
  }

  createApplicationSecret(appId: string, data: { name?: string; expires_at?: string }) {
    return this.request<ApplicationSecret & { secret: string }>(`/v1/applications/${appId}/secrets`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  disableApplicationSecret(appId: string, secretId: string) {
    return this.request<ApplicationSecret>(`/v1/applications/${appId}/secrets/${secretId}/disable`, { method: 'POST' });
  }

  deleteApplicationSecret(appId: string, secretId: string) {
    return this.request<ApplicationSecret>(`/v1/applications/${appId}/secrets/${secretId}`, { method: 'DELETE' });
  }

  getApplicationConsentSettings(appId: string) {
    return this.request<ApplicationConsentSettings>(`/v1/applications/${appId}/consent`);
  }

  updateApplicationConsentSettings(appId: string, data: ApplicationConsentSettings) {
    return this.request<ApplicationConsentSettings>(`/v1/applications/${appId}/consent`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  getApplicationSignInExperience(appId: string) {
    return this.request<ApplicationSignInExperience>(`/v1/applications/${appId}/sign-in-experience`);
  }

  updateApplicationSignInExperience(appId: string, data: ApplicationSignInExperienceInput) {
    return this.request<ApplicationSignInExperience>(`/v1/applications/${appId}/sign-in-experience`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  deleteApplicationSignInExperience(appId: string) {
    return this.request<void>(`/v1/applications/${appId}/sign-in-experience`, { method: 'DELETE' });
  }

  // ─── Application bindings ──────────────────────────────
  listApplicationBindings(appId: string) {
    return this.request<ListResponse<ApplicationBinding>>(`/v1/applications/${appId}/bindings`);
  }

  createApplicationBinding(appId: string, data: { resource_id: string; scope_id?: string }) {
    return this.request<ApplicationBinding>(`/v1/applications/${appId}/bindings`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  deleteApplicationBinding(appId: string, bindingId: string) {
    return this.request<void>(`/v1/applications/${appId}/bindings/${bindingId}`, { method: 'DELETE' });
  }

  listApplicationScopes(appId: string) {
    return this.request<ListResponse<Scope>>(`/v1/applications/${appId}/scopes`);
  }

  // ─── Connectors ───────────────────────────────────────
  listConnectors() {
    return this.request<unknown[]>('/v1/connectors');
  }

  getConnector(connectorId: string) {
    return this.request<Connector>(`/v1/connectors/${connectorId}`);
  }

  updateConnector(connectorId: string, data: Partial<Connector>) {
    return this.request<Connector>(`/v1/connectors/${connectorId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  testConnector(connectorId: string) {
    return this.request<{ connector_id: string; status: string }>(
      `/v1/connectors/${connectorId}/test`,
      { method: 'POST' },
    );
  }

  getConnectorAuthorizationUri(connectorId: string, params?: { redirect_uri?: string; state?: string; scope?: string }) {
    const qs = new URLSearchParams();
    if (params?.redirect_uri) qs.set('redirect_uri', params.redirect_uri);
    if (params?.state) qs.set('state', params.state);
    if (params?.scope) qs.set('scope', params.scope);
    const query = qs.toString();
    return this.request<unknown>(`/v1/connectors/${connectorId}/authorization-uri${query ? `?${query}` : ''}`);
  }

  listConnectorFactories(category?: string) {
    const qs = category ? `?category=${encodeURIComponent(category)}` : '';
    return this.request<ListResponse<ConnectorFactory>>(`/v1/connectors/factories${qs}`);
  }

  upsertConnectorFactory(factoryId: string, data: {
    name: string;
    protocol: string;
    category: string;
    config_schema?: Record<string, unknown>;
    enabled?: boolean;
  }) {
    return this.request<ConnectorFactory>(`/v1/connectors/factories/${factoryId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // ─── API Resources ────────────────────────────────────
  listResources() {
    return this.request<ListResponse<ApiResource>>('/v1/resources');
  }

  createResource(data: CreateResourceInput) {
    return this.request<ApiResource>('/v1/resources', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  getResource(resourceId: string) {
    return this.request<ApiResource>(`/v1/resources/${resourceId}`);
  }

  updateResource(resourceId: string, data: Partial<CreateResourceInput>) {
    return this.request<ApiResource>(`/v1/resources/${resourceId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  deleteResource(resourceId: string) {
    return this.request<void>(`/v1/resources/${resourceId}`, { method: 'DELETE' });
  }

  // ─── Scopes ───────────────────────────────────────────
  addScope(resourceId: string, data: { name: string; description?: string }) {
    return this.request<Scope>(`/v1/resources/${resourceId}/scopes`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  removeScope(resourceId: string, scopeId: string) {
    return this.request<void>(`/v1/resources/${resourceId}/scopes/${scopeId}`, { method: 'DELETE' });
  }

  // ─── Users ────────────────────────────────────────────
  listUsers() {
    return this.request<unknown[]>('/v1/users');
  }

  getUser(userId: string) {
    return this.request<unknown>(`/v1/users/${userId}`);
  }

  updateUser(userId: string, data: Record<string, unknown>) {
    return this.request<unknown>(`/v1/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  suspendUser(userId: string, data: Record<string, unknown> = {}) {
    return this.request<unknown>(`/v1/users/${userId}/suspend`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  deleteUser(userId: string) {
    return this.request<void>(`/v1/users/${userId}`, { method: 'DELETE' });
  }

  listUserSessions(userId: string) {
    return this.request<ListResponse<unknown>>(`/v1/users/${userId}/sessions`);
  }

  revokeUserSession(userId: string, sessionId: string) {
    return this.request<unknown>(`/v1/users/${userId}/sessions/${sessionId}/revoke`, { method: 'POST' });
  }

  unlinkUserIdentity(userId: string, identityId: string) {
    return this.request<unknown>(`/v1/users/${userId}/identities/${identityId}`, { method: 'DELETE' });
  }

  resetUserMfa(userId: string, factorId: string) {
    return this.request<unknown>(`/v1/users/${userId}/mfa/${factorId}/reset`, { method: 'POST' });
  }

  // ─── Account Center ───────────────────────────────────
  getMyAccountProfile(userId: string) {
    return this.request<unknown>('/v1/my-account/profile', { headers: { 'x-supaoauth-user-id': userId } });
  }

  updateMyAccountProfile(userId: string, data: Record<string, unknown>) {
    return this.request<unknown>('/v1/my-account/profile', {
      method: 'PATCH',
      headers: { 'x-supaoauth-user-id': userId },
      body: JSON.stringify(data),
    });
  }

  listMyAccountSessions(userId: string) {
    return this.request<ListResponse<unknown>>('/v1/my-account/sessions', { headers: { 'x-supaoauth-user-id': userId } });
  }

  revokeMyAccountSession(userId: string, sessionId: string) {
    return this.request<unknown>(`/v1/my-account/sessions/${sessionId}/revoke`, {
      method: 'POST',
      headers: { 'x-supaoauth-user-id': userId },
    });
  }

  listMyAccountGrants(userId: string) {
    return this.request<ListResponse<UserConsent>>('/v1/my-account/grants', { headers: { 'x-supaoauth-user-id': userId } });
  }

  revokeMyAccountGrant(userId: string, consentId: string) {
    return this.request<UserConsent>(`/v1/my-account/grants/${consentId}`, {
      method: 'DELETE',
      headers: { 'x-supaoauth-user-id': userId },
    });
  }

  getUserPermissions(userId: string, orgId?: string) {
    const qs = orgId ? `?org_id=${orgId}` : '';
    return this.request<UserPermissions>(`/v1/users/${userId}/permissions${qs}`);
  }

  getUserRoles(userId: string) {
    return this.request<ListResponse<RoleAssignment>>(`/v1/users/${userId}/roles`);
  }

  // ─── Organizations ────────────────────────────────────
  listOrganizations() {
    return this.request<ListResponse<Organization>>('/v1/organizations');
  }

  createOrganization(data: { name: string; description?: string }) {
    return this.request<Organization>('/v1/organizations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  getOrganization(orgId: string) {
    return this.request<Organization>(`/v1/organizations/${orgId}`);
  }

  updateOrganization(orgId: string, data: { name?: string; description?: string }) {
    return this.request<Organization>(`/v1/organizations/${orgId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  deleteOrganization(orgId: string) {
    return this.request<void>(`/v1/organizations/${orgId}`, { method: 'DELETE' });
  }

  addOrganizationMember(orgId: string, data: { user_id: string; role?: string }) {
    return this.request<OrganizationMember>(`/v1/organizations/${orgId}/members`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  removeOrganizationMember(orgId: string, userId: string) {
    return this.request<void>(`/v1/organizations/${orgId}/members/${userId}`, { method: 'DELETE' });
  }

  updateOrganizationMemberRole(orgId: string, userId: string, data: { role: string }) {
    return this.request<OrganizationMember>(`/v1/organizations/${orgId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  listOrganizationInvitations(orgId: string) {
    return this.request<ListResponse<OrganizationInvitation>>(`/v1/organizations/${orgId}/invitations`);
  }

  createOrganizationInvitation(orgId: string, data: { email: string; role?: string; expires_at?: string }) {
    return this.request<OrganizationInvitation>(`/v1/organizations/${orgId}/invitations`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  updateOrganizationInvitationStatus(orgId: string, invitationId: string, action: 'accepted' | 'revoked' | 'expired') {
    return this.request<OrganizationInvitation>(`/v1/organizations/${orgId}/invitations/${invitationId}/${action}`, {
      method: 'POST',
    });
  }

  getOrganizationJitSettings(orgId: string) {
    return this.request<OrganizationJitSettings>(`/v1/organizations/${orgId}/jit`);
  }

  updateOrganizationJitSettings(orgId: string, data: Partial<OrganizationJitSettings>) {
    return this.request<OrganizationJitSettings>(`/v1/organizations/${orgId}/jit`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  listOrganizationApplications(orgId: string) {
    return this.request<ListResponse<unknown>>(`/v1/organizations/${orgId}/applications`);
  }

  upsertOrganizationApplication(orgId: string, appId: string, data: { role_ids?: string[]; enabled?: boolean }) {
    return this.request<unknown>(`/v1/organizations/${orgId}/applications/${appId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  removeOrganizationApplication(orgId: string, appId: string) {
    return this.request<unknown>(`/v1/organizations/${orgId}/applications/${appId}`, { method: 'DELETE' });
  }

  // ─── Roles ────────────────────────────────────────────
  listRoles() {
    return this.request<ListResponse<Role>>('/v1/roles');
  }

  createRole(data: { name: string; description?: string }) {
    return this.request<Role>('/v1/roles', { method: 'POST', body: JSON.stringify(data) });
  }

  getRole(roleId: string) {
    return this.request<Role>(`/v1/roles/${roleId}`);
  }

  updateRole(roleId: string, data: { name?: string; description?: string }) {
    return this.request<Role>(`/v1/roles/${roleId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  deleteRole(roleId: string) {
    return this.request<void>(`/v1/roles/${roleId}`, { method: 'DELETE' });
  }

  // ─── Permissions ──────────────────────────────────────
  listRolePermissions(roleId: string) {
    return this.request<ListResponse<Permission>>(`/v1/roles/${roleId}/permissions`);
  }

  createRolePermission(
    roleId: string,
    data: { name: string; description?: string; scope_id?: string },
  ) {
    return this.request<Permission>(`/v1/roles/${roleId}/permissions`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  deleteRolePermission(roleId: string, permissionId: string) {
    return this.request<void>(`/v1/roles/${roleId}/permissions/${permissionId}`, {
      method: 'DELETE',
    });
  }

  // ─── Role assignments ─────────────────────────────────
  assignRole(
    roleId: string,
    data: { user_id?: string; organization_id?: string; application_id?: string },
  ) {
    return this.request<RoleAssignment>(`/v1/roles/${roleId}/assign`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  listRoleAssignments(roleId: string) {
    return this.request<ListResponse<RoleAssignment>>(`/v1/roles/${roleId}/assign`);
  }

  revokeRole(roleId: string, assignmentId: string) {
    return this.request<void>(`/v1/roles/${roleId}/assign/${assignmentId}`, {
      method: 'DELETE',
    });
  }

  getOrgRoleAssignments(orgId: string) {
    return this.request<ListResponse<RoleAssignment>>(`/v1/organizations/${orgId}/roles`);
  }

  // ─── Sign-in Experience ───────────────────────────────
  getSignInExperience() {
    return this.request<SignInExperience>('/v1/sign-in-experience');
  }

  resolveSignInExperience(applicationId?: string) {
    const qs = applicationId ? `?application_id=${encodeURIComponent(applicationId)}` : '';
    return this.request<EffectiveSignInExperience>(`/v1/sign-in-experience/resolve${qs}`);
  }

  resolvePublicSignInExperience(params: { application_id?: string; authorization_id?: string } = {}) {
    const qs = new URLSearchParams();
    if (params.application_id) qs.set('application_id', params.application_id);
    if (params.authorization_id) qs.set('authorization_id', params.authorization_id);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.request<PublicEffectiveSignInExperience>(`/v1/public/sign-in-experience/resolve${suffix}`);
  }

  getPublicPhrases(languageTag: string) {
    return this.request<PublicPhraseBundle>(`/v1/public/phrases/${encodeURIComponent(languageTag)}`);
  }

  updateSignInExperience(data: Partial<SignInExperience>) {
    return this.request<SignInExperience>('/v1/sign-in-experience', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // ─── Auth Config ──────────────────────────────────────
  getAuthConfig() {
    return this.request<AuthConfigResponse>('/v1/auth-config');
  }

  updateAuthConfig(data: Partial<AuthConfigResponse>) {
    return this.request<AuthConfigResponse>('/v1/auth-config', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  // ─── Compatibility ────────────────────────────────────
  getCompatibilityReport() {
    return this.request<{ checks: CompatibilityCheckResult[]; total: number; passed: number }>('/v1/compatibility/supabase');
  }

  // ─── Tenant Config ────────────────────────────────────
  listTenantConfigs(type?: string) {
    const qs = type ? `?type=${encodeURIComponent(type)}` : '';
    return this.request<ListResponse<TenantConfig>>(`/v1/tenant-config${qs}`);
  }

  getTenantConfig(type: string, key: string) {
    return this.request<TenantConfig>(`/v1/tenant-config/${encodeURIComponent(type)}/${encodeURIComponent(key)}`);
  }

  upsertTenantConfig(type: string, key: string, data: { value?: Record<string, unknown>; enabled?: boolean }) {
    return this.request<TenantConfig>(`/v1/tenant-config/${encodeURIComponent(type)}/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  deleteTenantConfig(type: string, key: string) {
    return this.request<TenantConfig>(`/v1/tenant-config/${encodeURIComponent(type)}/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
  }

  checkTenantDomain(domain: string) {
    return this.request<unknown>(`/v1/tenant-config/domain/${encodeURIComponent(domain)}/check`, { method: 'POST' });
  }

  // ─── Auth Hooks ───────────────────────────────────────
  getAuthHookRegistrationGuide(hookSecret: string) {
    return this.request<AuthHookRegistrationGuide>('/v1/auth-hooks/registration-guide', {
      headers: { 'x-supaoauth-hook-secret': hookSecret },
    });
  }

  // ─── Webhooks ─────────────────────────────────────────
  listWebhooks() {
    return this.request<ListResponse<Webhook>>('/v1/webhooks');
  }

  createWebhook(data: { url: string; events: string[]; enabled?: boolean }) {
    return this.request<Webhook>('/v1/webhooks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  getWebhook(webhookId: string) {
    return this.request<Webhook>(`/v1/webhooks/${webhookId}`);
  }

  updateWebhook(webhookId: string, data: Partial<{ url: string; events: string[]; enabled: boolean }>) {
    return this.request<Webhook>(`/v1/webhooks/${webhookId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  deleteWebhook(webhookId: string) {
    return this.request<void>(`/v1/webhooks/${webhookId}`, { method: 'DELETE' });
  }

  rotateWebhookSecret(webhookId: string) {
    return this.request<Webhook & { secret: string }>(`/v1/webhooks/${webhookId}/rotate-secret`, {
      method: 'POST',
    });
  }

  listWebhookLogs(webhookId: string, limit?: number) {
    const qs = limit ? `?limit=${limit}` : '';
    return this.request<ListResponse<WebhookDeliveryLog>>(`/v1/webhooks/${webhookId}/logs${qs}`);
  }

  testWebhook(webhookId: string, data?: { event?: string; payload?: Record<string, unknown> }) {
    return this.request<{ ok: boolean; status?: number; error?: string }>(`/v1/webhooks/${webhookId}/test`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
  }

  replayWebhook(webhookId: string, data: { event: string; payload?: Record<string, unknown> }) {
    return this.request<{ ok: boolean; status?: number; error?: string }>(`/v1/webhooks/${webhookId}/replay`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  listWebhookEvents() {
    return this.request<WebhookEventList>('/v1/webhooks/events');
  }

  // ─── Metadata sync ────────────────────────────────────
  syncUserMetadata(userId: string, orgId?: string) {
    const qs = orgId ? `?org_id=${orgId}` : '';
    return this.request<SyncResult>(`/v1/sync/user/${userId}${qs}`, { method: 'POST' });
  }

  syncOrgMetadata(orgId: string) {
    return this.request<{ results: SyncResult[]; total: number; failed: number }>(
      `/v1/sync/org/${orgId}`,
      { method: 'POST' },
    );
  }

  // ─── Audit ────────────────────────────────────────────
  listAuditLogs(params?: {
    event_type?: string;
    resource_type?: string;
    resource_id?: string;
    actor_id?: string;
    limit?: number;
    offset?: number;
    from?: string;
    to?: string;
  }) {
    const qs = new URLSearchParams();
    if (params?.event_type) qs.set('event_type', params.event_type);
    if (params?.resource_type) qs.set('resource_type', params.resource_type);
    if (params?.resource_id) qs.set('resource_id', params.resource_id);
    if (params?.actor_id) qs.set('actor_id', params.actor_id);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    const query = qs.toString();
    return this.request<ListResponse<AuditLogEntry>>(`/v1/audit${query ? `?${query}` : ''}`);
  }

  // ─── RLS Migration Assistant ──────────────────────────
  compileAuthorizationPlan(data: AuthorizationCompileRequest) {
    return this.request<AuthorizationCompileResult>('/v1/admin-tools/authorization-compiler', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  getAuthorizationCompilerDemo() {
    return this.request<AuthorizationCompileResult>('/v1/admin-tools/authorization-compiler/demo');
  }

  generateRLSMigration(policies: ExistingPolicy[]) {
    return this.request<MigrationResult>('/v1/admin-tools/rls-migration', {
      method: 'POST',
      body: JSON.stringify({ policies }),
    });
  }

  getRLSMigrationDemo() {
    return this.request<MigrationResult>('/v1/admin-tools/rls-migration/demo');
  }

  // ─── Consents ─────────────────────────────────────────
  listUserConsents(userId: string) {
    return this.request<ListResponse<UserConsent>>(`/v1/consents?user_id=${encodeURIComponent(userId)}`);
  }

  grantConsent(data: { user_id: string; application_id: string; scope_id?: string; organization_id?: string }) {
    return this.request<UserConsent>('/v1/consents', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  revokeConsent(consentId: string) {
    return this.request<UserConsent>(`/v1/consents/${consentId}`, { method: 'DELETE' });
  }

  listApplicationConsents(applicationId: string) {
    return this.request<ListResponse<UserConsent>>(`/v1/consents/application/${applicationId}`);
  }

  // ─── Organization templates ───────────────────────────
  listOrgTemplates() {
    return this.request<ListResponse<OrganizationTemplate>>('/v1/org-templates');
  }

  createOrgTemplate(data: {
    name: string;
    description?: string;
    template_roles?: Array<{ name: string; permissions: string[] }>;
    template_scopes?: Array<{ name: string; description?: string }>;
    is_default?: boolean;
  }) {
    return this.request<OrganizationTemplate>('/v1/org-templates', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  instantiateOrgTemplate(templateId: string, data: { name: string; description?: string; creator_user_id: string }) {
    return this.request<unknown>(`/v1/org-templates/${templateId}/instantiate`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ─── Security and provisioning ────────────────────────
  getSecurityStatus() {
    return this.request<SecurityStatus>('/v1/security-config/status');
  }

  getProvisioningStatus(projectRef: string) {
    return this.request<unknown>(`/v1/provisioning/${projectRef}`);
  }

  reconcileProject(projectRef: string) {
    return this.request<unknown>(`/v1/provisioning/${projectRef}/reconcile`, { method: 'POST' });
  }

  // ─── Enterprise SSO / Passkeys ────────────────────────
  listEnterpriseSSOConfigs() {
    return this.request<ListResponse<EnterpriseSSOConfig>>('/v1/enterprise-sso');
  }

  createEnterpriseSSOConfig(data: {
    connector_id: string;
    domains: string[];
    sso_protocol?: string;
    jit_provisioning?: boolean;
    org_membership_mapping?: Record<string, string>;
    role_mapping?: Record<string, string>;
  }) {
    return this.request<EnterpriseSSOConfig>('/v1/enterprise-sso', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  listUserPasskeys(userId: string) {
    return this.request<ListResponse<Passkey>>(`/v1/passkeys/${userId}`);
  }
}
