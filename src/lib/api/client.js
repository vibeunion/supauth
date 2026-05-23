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

// OIDC Discovery (proxied through BFF to avoid CORS issues)
export function getDiscovery() {
  return request('/v1/runtime/discovery');
}

export function getJWKS() {
  return request('/v1/runtime/jwks');
}

// Applications (formerly OAuth Clients)
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

// Connectors (formerly SSO Providers)
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

// Users (proxied through BFF)
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
