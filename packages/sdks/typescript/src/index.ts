// @supaoauth/sdk-typescript — TypeScript SDK for SupaOAuth Management API
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
  AuditLogEntry,
  Webhook,
  RuntimeMode,
  CompatibilityCheckResult,
} from '@supaoauth/shared';

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
    return this.request<unknown[]>('/v1/applications');
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

  deleteUser(userId: string) {
    return this.request<void>(`/v1/users/${userId}`, { method: 'DELETE' });
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
    data: { user_id: string; organization_id?: string; application_id?: string },
  ) {
    return this.request<RoleAssignment>(`/v1/roles/${roleId}/assign`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
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
  generateRLSMigration(policies: ExistingPolicy[]) {
    return this.request<MigrationResult>('/v1/admin-tools/rls-migration', {
      method: 'POST',
      body: JSON.stringify({ policies }),
    });
  }

  getRLSMigrationDemo() {
    return this.request<MigrationResult>('/v1/admin-tools/rls-migration/demo');
  }
}
