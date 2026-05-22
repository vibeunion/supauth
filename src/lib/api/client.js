// SupaOAuth API client — talks to SupaCloud Management API
const API_BASE = import.meta.env.VITE_SUPACLOUD_API_URL || 'http://localhost:9090';
const MASTER_TOKEN = import.meta.env.VITE_MASTER_TOKEN || '';
const PROJECT_REF = import.meta.env.VITE_PROJECT_REF || '';

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(MASTER_TOKEN ? { Authorization: `Bearer ${MASTER_TOKEN}` } : {}),
    ...options.headers,
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

// OAuth Server status
export function getOAuthServerStatus() {
  return request(`/v1/projects/${PROJECT_REF}/auth/oauth-server`);
}

// OAuth Clients
export function listOAuthClients() {
  return request(`/v1/projects/${PROJECT_REF}/auth/oauth-clients`);
}

export function createOAuthClient(data) {
  return request(`/v1/projects/${PROJECT_REF}/auth/oauth-clients`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getOAuthClient(clientId) {
  return request(`/v1/projects/${PROJECT_REF}/auth/oauth-clients/${clientId}`);
}

export function updateOAuthClient(clientId, data) {
  return request(`/v1/projects/${PROJECT_REF}/auth/oauth-clients/${clientId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteOAuthClient(clientId) {
  return request(`/v1/projects/${PROJECT_REF}/auth/oauth-clients/${clientId}`, {
    method: 'DELETE',
  });
}

export function regenerateClientSecret(clientId) {
  return request(`/v1/projects/${PROJECT_REF}/auth/oauth-clients/${clientId}/regenerate-secret`, {
    method: 'POST',
  });
}

// SSO Providers
export function listProviders() {
  return request(`/v1/projects/${PROJECT_REF}/auth/providers`);
}

export function getProvider(providerId) {
  return request(`/v1/projects/${PROJECT_REF}/auth/providers/${providerId}`);
}

export function updateProvider(providerId, data) {
  return request(`/v1/projects/${PROJECT_REF}/auth/providers/${providerId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// Users
export function listUsers() {
  return request(`/v1/projects/${PROJECT_REF}/auth/users`);
}

export function getUser(userId) {
  return request(`/v1/projects/${PROJECT_REF}/auth/users/${userId}`);
}

export function deleteUser(userId) {
  return request(`/v1/projects/${PROJECT_REF}/auth/users/${userId}`, {
    method: 'DELETE',
  });
}

// Auth config
export function getAuthConfig() {
  return request(`/v1/projects/${PROJECT_REF}/config/auth`);
}

export function updateAuthConfig(data) {
  return request(`/v1/projects/${PROJECT_REF}/config/auth`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// OIDC Discovery (direct to GoTrue via Kong)
const OAUTH_BASE = import.meta.env.VITE_OAUTH_URL || 'http://localhost:9999';

export async function getDiscovery() {
  const res = await fetch(`${OAUTH_BASE}/auth/v1/.well-known/openid-configuration`);
  return res.json();
}

export async function getJWKS() {
  const res = await fetch(`${OAUTH_BASE}/auth/v1/.well-known/jwks.json`);
  return res.json();
}

// Project info
export function getProject() {
  return request(`/v1/projects/${PROJECT_REF}`);
}
