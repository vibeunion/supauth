// @supaoauth/sdk-typescript — TypeScript SDK for SupaOAuth Management API

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

  // ─── Health ────────────────────────────────────────────
  health() {
    return this.request<{ status: string; runtime_mode: string; project_ref: string }>('/v1/health');
  }

  // ─── Applications ─────────────────────────────────────
  listApplications() {
    return this.request('/v1/applications');
  }
  createApplication(data: Record<string, unknown>) {
    return this.request('/v1/applications', { method: 'POST', body: JSON.stringify(data) });
  }
  getApplication(appId: string) {
    return this.request(`/v1/applications/${appId}`);
  }
  updateApplication(appId: string, data: Record<string, unknown>) {
    return this.request(`/v1/applications/${appId}`, { method: 'PUT', body: JSON.stringify(data) });
  }
  deleteApplication(appId: string) {
    return this.request(`/v1/applications/${appId}`, { method: 'DELETE' });
  }
  rotateApplicationSecret(appId: string) {
    return this.request(`/v1/applications/${appId}/rotate-secret`, { method: 'POST' });
  }

  // ─── Application bindings ──────────────────────────────
  listApplicationBindings(appId: string) {
    return this.request(`/v1/applications/${appId}/bindings`);
  }
  createApplicationBinding(appId: string, data: { resource_id: string; scope_id?: string }) {
    return this.request(`/v1/applications/${appId}/bindings`, { method: 'POST', body: JSON.stringify(data) });
  }
  deleteApplicationBinding(appId: string, bindingId: string) {
    return this.request(`/v1/applications/${appId}/bindings/${bindingId}`, { method: 'DELETE' });
  }
  listApplicationScopes(appId: string) {
    return this.request(`/v1/applications/${appId}/scopes`);
  }

  // ─── Connectors ───────────────────────────────────────
  listConnectors() {
    return this.request('/v1/connectors');
  }
  getConnector(connectorId: string) {
    return this.request(`/v1/connectors/${connectorId}`);
  }
  updateConnector(connectorId: string, data: Record<string, unknown>) {
    return this.request(`/v1/connectors/${connectorId}`, { method: 'PATCH', body: JSON.stringify(data) });
  }
  testConnector(connectorId: string) {
    return this.request(`/v1/connectors/${connectorId}/test`, { method: 'POST' });
  }

  // ─── API Resources ─────────────────────────────────────
  listResources() {
    return this.request('/v1/resources');
  }
  createResource(data: Record<string, unknown>) {
    return this.request('/v1/resources', { method: 'POST', body: JSON.stringify(data) });
  }
  getResource(resourceId: string) {
    return this.request(`/v1/resources/${resourceId}`);
  }
  updateResource(resourceId: string, data: Record<string, unknown>) {
    return this.request(`/v1/resources/${resourceId}`, { method: 'PUT', body: JSON.stringify(data) });
  }
  deleteResource(resourceId: string) {
    return this.request(`/v1/resources/${resourceId}`, { method: 'DELETE' });
  }

  // ─── Users ─────────────────────────────────────────────
  listUsers() {
    return this.request('/v1/users');
  }
  getUser(userId: string) {
    return this.request(`/v1/users/${userId}`);
  }
  deleteUser(userId: string) {
    return this.request(`/v1/users/${userId}`, { method: 'DELETE' });
  }
  getUserPermissions(userId: string, orgId?: string) {
    const qs = orgId ? `?org_id=${orgId}` : '';
    return this.request(`/v1/users/${userId}/permissions${qs}`);
  }
  getUserRoles(userId: string) {
    return this.request(`/v1/users/${userId}/roles`);
  }

  // ─── Organizations ─────────────────────────────────────
  listOrganizations() {
    return this.request('/v1/organizations');
  }
  createOrganization(data: Record<string, unknown>) {
    return this.request('/v1/organizations', { method: 'POST', body: JSON.stringify(data) });
  }
  getOrganization(orgId: string) {
    return this.request(`/v1/organizations/${orgId}`);
  }
  updateOrganization(orgId: string, data: Record<string, unknown>) {
    return this.request(`/v1/organizations/${orgId}`, { method: 'PUT', body: JSON.stringify(data) });
  }
  deleteOrganization(orgId: string) {
    return this.request(`/v1/organizations/${orgId}`, { method: 'DELETE' });
  }

  // ─── Roles ─────────────────────────────────────────────
  listRoles() {
    return this.request('/v1/roles');
  }
  createRole(data: { name: string; description?: string }) {
    return this.request('/v1/roles', { method: 'POST', body: JSON.stringify(data) });
  }
  getRole(roleId: string) {
    return this.request(`/v1/roles/${roleId}`);
  }
  updateRole(roleId: string, data: Record<string, unknown>) {
    return this.request(`/v1/roles/${roleId}`, { method: 'PUT', body: JSON.stringify(data) });
  }
  deleteRole(roleId: string) {
    return this.request(`/v1/roles/${roleId}`, { method: 'DELETE' });
  }
  listRolePermissions(roleId: string) {
    return this.request(`/v1/roles/${roleId}/permissions`);
  }
  createRolePermission(roleId: string, data: { name: string; description?: string; scope_id?: string }) {
    return this.request(`/v1/roles/${roleId}/permissions`, { method: 'POST', body: JSON.stringify(data) });
  }
  deleteRolePermission(roleId: string, permissionId: string) {
    return this.request(`/v1/roles/${roleId}/permissions/${permissionId}`, { method: 'DELETE' });
  }
  assignRole(roleId: string, data: { user_id: string; organization_id?: string; application_id?: string }) {
    return this.request(`/v1/roles/${roleId}/assign`, { method: 'POST', body: JSON.stringify(data) });
  }
  revokeRole(roleId: string, assignmentId: string) {
    return this.request(`/v1/roles/${roleId}/assign/${assignmentId}`, { method: 'DELETE' });
  }

  // ─── Webhooks ──────────────────────────────────────────
  listWebhooks() {
    return this.request('/v1/webhooks');
  }
  createWebhook(data: { url: string; events: string[]; enabled?: boolean }) {
    return this.request('/v1/webhooks', { method: 'POST', body: JSON.stringify(data) });
  }
  getWebhook(webhookId: string) {
    return this.request(`/v1/webhooks/${webhookId}`);
  }
  updateWebhook(webhookId: string, data: Record<string, unknown>) {
    return this.request(`/v1/webhooks/${webhookId}`, { method: 'PUT', body: JSON.stringify(data) });
  }
  deleteWebhook(webhookId: string) {
    return this.request(`/v1/webhooks/${webhookId}`, { method: 'DELETE' });
  }
  rotateWebhookSecret(webhookId: string) {
    return this.request(`/v1/webhooks/${webhookId}/rotate-secret`, { method: 'POST' });
  }
  listWebhookEvents() {
    return this.request<{ events: string[] }>('/v1/webhooks/events');
  }

  // ─── Sign-in Experience ─────────────────────────────────
  getSignInExperience() {
    return this.request('/v1/sign-in-experience');
  }
  updateSignInExperience(data: Record<string, unknown>) {
    return this.request('/v1/sign-in-experience', { method: 'PUT', body: JSON.stringify(data) });
  }

  // ─── Auth Config ───────────────────────────────────────
  getAuthConfig() {
    return this.request('/v1/auth-config');
  }
  updateAuthConfig(data: Record<string, unknown>) {
    return this.request('/v1/auth-config', { method: 'PATCH', body: JSON.stringify(data) });
  }

  // ─── Compatibility ─────────────────────────────────────
  getCompatibilityReport() {
    return this.request('/v1/compatibility/supabase');
  }

  // ─── Runtime ───────────────────────────────────────────
  getRuntimeHealth() {
    return this.request('/v1/runtime/health');
  }
  getOAuthServerStatus() {
    return this.request('/v1/runtime/oauth-server');
  }
  getDiscovery() {
    return this.request('/v1/runtime/discovery');
  }
  getJWKS() {
    return this.request('/v1/runtime/jwks');
  }

  // ─── Metadata Sync ─────────────────────────────────────
  syncUserMetadata(userId: string, orgId?: string) {
    const qs = orgId ? `?org_id=${orgId}` : '';
    return this.request(`/v1/sync/user/${userId}${qs}`, { method: 'POST' });
  }
  syncOrgMetadata(orgId: string) {
    return this.request(`/v1/sync/org/${orgId}`, { method: 'POST' });
  }

  // ─── Audit ─────────────────────────────────────────────
  listAuditLogs(params?: { event_type?: string; resource_type?: string; limit?: number; offset?: number }) {
    const qs = new URLSearchParams();
    if (params?.event_type) qs.set('event_type', params.event_type);
    if (params?.resource_type) qs.set('resource_type', params.resource_type);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const query = qs.toString();
    return this.request(`/v1/audit${query ? `?${query}` : ''}`);
  }
}

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
