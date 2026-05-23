// SupaOAuth API client — all management calls go through the auth-server BFF.
// No SupaCloud master token or service-role key is exposed to the browser.

const API_BASE = import.meta.env.VITE_AUTH_SERVER_URL || '/api';
const TOKEN_KEY = 'supaoauth_admin_token';

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };
  const res = await fetch(url, { ...options, headers, credentials: 'include' });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

// Dashboard / Runtime status
export function getOAuthServerStatus() {
  return request('/v1/runtime/oauth-server');
}

export function getProject() {
  return request('/v1/project');
}

export function getDiscovery() {
  return request('/v1/runtime/discovery');
}

export function getJWKS() {
  return request('/v1/runtime/jwks');
}

// Applications
export function listApplications() {
  return request('/v1/applications');
}

export function createApplication(data) {
  return request('/v1/applications', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getApplication(appId) {
  return request(`/v1/applications/${appId}`);
}

export function updateApplication(appId, data) {
  return request(`/v1/applications/${appId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteApplication(appId) {
  return request(`/v1/applications/${appId}`, {
    method: 'DELETE',
  });
}

export function rotateApplicationSecret(appId) {
  return request(`/v1/applications/${appId}/rotate-secret`, {
    method: 'POST',
  });
}

// Application-Resource/Scope bindings
export function listApplicationBindings(appId) {
  return request(`/v1/applications/${appId}/bindings`);
}

export function createApplicationBinding(appId, data) {
  return request(`/v1/applications/${appId}/bindings`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function deleteApplicationBinding(appId, bindingId) {
  return request(`/v1/applications/${appId}/bindings/${bindingId}`, {
    method: 'DELETE',
  });
}

export function listApplicationScopes(appId) {
  return request(`/v1/applications/${appId}/scopes`);
}

// Connectors
export function listConnectors() {
  return request('/v1/connectors');
}

export function getConnector(connectorId) {
  return request(`/v1/connectors/${connectorId}`);
}

export function updateConnector(connectorId, data) {
  return request(`/v1/connectors/${connectorId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function testConnector(connectorId) {
  return request(`/v1/connectors/${connectorId}/test`, {
    method: 'POST',
  });
}

// API Resources
export function listResources() {
  return request('/v1/resources');
}

export function createResource(data) {
  return request('/v1/resources', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getResource(resourceId) {
  return request(`/v1/resources/${resourceId}`);
}

export function updateResource(resourceId, data) {
  return request(`/v1/resources/${resourceId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteResource(resourceId) {
  return request(`/v1/resources/${resourceId}`, {
    method: 'DELETE',
  });
}

// Users
export function listUsers() {
  return request('/v1/users');
}

export function getUser(userId) {
  return request(`/v1/users/${userId}`);
}

export function deleteUser(userId) {
  return request(`/v1/users/${userId}`, {
    method: 'DELETE',
  });
}

export function getUserPermissions(userId, orgId) {
  const qs = orgId ? `?org_id=${orgId}` : '';
  return request(`/v1/users/${userId}/permissions${qs}`);
}

export function getUserRoles(userId) {
  return request(`/v1/users/${userId}/roles`);
}

// Organizations
export function listOrganizations() {
  return request('/v1/organizations');
}

export function createOrganization(data) {
  return request('/v1/organizations', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getOrganization(orgId) {
  return request(`/v1/organizations/${orgId}`);
}

export function updateOrganization(orgId, data) {
  return request(`/v1/organizations/${orgId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteOrganization(orgId) {
  return request(`/v1/organizations/${orgId}`, {
    method: 'DELETE',
  });
}

// Roles
export function listRoles() {
  return request('/v1/roles');
}

export function createRole(data) {
  return request('/v1/roles', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getRole(roleId) {
  return request(`/v1/roles/${roleId}`);
}

export function updateRole(roleId, data) {
  return request(`/v1/roles/${roleId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteRole(roleId) {
  return request(`/v1/roles/${roleId}`, {
    method: 'DELETE',
  });
}

export function listRolePermissions(roleId) {
  return request(`/v1/roles/${roleId}/permissions`);
}

export function createRolePermission(roleId, data) {
  return request(`/v1/roles/${roleId}/permissions`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function deleteRolePermission(roleId, permissionId) {
  return request(`/v1/roles/${roleId}/permissions/${permissionId}`, {
    method: 'DELETE',
  });
}

export function assignRole(roleId, data) {
  return request(`/v1/roles/${roleId}/assign`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function revokeRole(roleId, assignmentId) {
  return request(`/v1/roles/${roleId}/assign/${assignmentId}`, {
    method: 'DELETE',
  });
}

// Settings / Sign-in Experience
export function getSignInExperience() {
  return request('/v1/sign-in-experience');
}

export function updateSignInExperience(data) {
  return request('/v1/sign-in-experience', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function getAuthConfig() {
  return request('/v1/auth-config');
}

export function updateAuthConfig(data) {
  return request('/v1/auth-config', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// Compatibility check
export function getCompatibilityReport() {
  return request('/v1/compatibility/supabase');
}

// Webhooks
export function listWebhooks() {
  return request('/v1/webhooks');
}

export function createWebhook(data) {
  return request('/v1/webhooks', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getWebhook(webhookId) {
  return request(`/v1/webhooks/${webhookId}`);
}

export function updateWebhook(webhookId, data) {
  return request(`/v1/webhooks/${webhookId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteWebhook(webhookId) {
  return request(`/v1/webhooks/${webhookId}`, {
    method: 'DELETE',
  });
}

export function rotateWebhookSecret(webhookId) {
  return request(`/v1/webhooks/${webhookId}/rotate-secret`, {
    method: 'POST',
  });
}

export function listWebhookEvents() {
  return request('/v1/webhooks/events');
}

// Storage
export function listStorageBuckets() {
  return request('/v1/storage/buckets');
}

export function createStorageBucket(bucketId) {
  return request(`/v1/storage/buckets/${bucketId}`, { method: 'POST' });
}

export function uploadFile(bucketId, filePath, file, contentType) {
  return request(`/v1/storage/upload/${bucketId}/${filePath}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: file,
  });
}

export function getSignedUrl(bucketId, filePath, expiresIn) {
  return request(`/v1/storage/sign-url/${bucketId}/${filePath}?expires=${expiresIn || 3600}`);
}

export function deleteFile(bucketId, filePath) {
  return request(`/v1/storage/delete/${bucketId}/${filePath}`, { method: 'DELETE' });
}

export function uploadAvatar(userId, file, contentType) {
  return request(`/v1/storage/avatar/${userId}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: file,
  });
}

export function uploadBranding(assetType, file, contentType) {
  return request(`/v1/storage/branding/${assetType}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: file,
  });
}

// Metadata sync
export function syncUserMetadata(userId, orgId) {
  const qs = orgId ? `?org_id=${orgId}` : '';
  return request(`/v1/sync/user/${userId}${qs}`, { method: 'POST' });
}

export function syncOrgMetadata(orgId) {
  return request(`/v1/sync/org/${orgId}`, { method: 'POST' });
}
