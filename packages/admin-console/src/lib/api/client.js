// SupaOAuth API client — all management calls go through the auth-server BFF.
// No SupaCloud master token or service-role key is exposed to the browser.

import { adminApiRequest } from '../admin-api.js';

async function request(path, options = {}) {
  return adminApiRequest(path, options);
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

export function listApplicationSecrets(appId) {
  return request(`/v1/applications/${appId}/secrets`);
}

export function createApplicationSecret(appId, data) {
  return request(`/v1/applications/${appId}/secrets`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function disableApplicationSecret(appId, secretId) {
  return request(`/v1/applications/${appId}/secrets/${secretId}/disable`, { method: 'POST' });
}

export function getApplicationConsent(appId) {
  return request(`/v1/applications/${appId}/consent`);
}

export function updateApplicationConsent(appId, data) {
  return request(`/v1/applications/${appId}/consent`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function getApplicationSignInExperience(appId) {
  return request(`/v1/applications/${appId}/sign-in-experience`);
}

export function updateApplicationSignInExperience(appId, data) {
  return request(`/v1/applications/${appId}/sign-in-experience`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteApplicationSignInExperience(appId) {
  return request(`/v1/applications/${appId}/sign-in-experience`, { method: 'DELETE' });
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

export function listConnectorFactories(category) {
  const qs = category ? `?category=${encodeURIComponent(category)}` : '';
  return request(`/v1/connectors/factories${qs}`);
}

export function upsertConnectorFactory(factoryId, data) {
  return request(`/v1/connectors/factories/${factoryId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
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

export function updateUser(userId, data) {
  return request(`/v1/users/${userId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function suspendUser(userId, data = {}) {
  return request(`/v1/users/${userId}/suspend`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function unsuspendUser(userId) {
  return request(`/v1/users/${userId}/unsuspend`, {
    method: 'POST',
  });
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

export function listUserSessions(userId) {
  return request(`/v1/users/${userId}/sessions`);
}

export function revokeUserSession(userId, sessionId) {
  return request(`/v1/users/${userId}/sessions/${sessionId}/revoke`, { method: 'POST' });
}

export function unlinkUserIdentity(userId, identityId) {
  return request(`/v1/users/${userId}/identities/${identityId}`, { method: 'DELETE' });
}

export function resetUserMfa(userId, factorId) {
  return request(`/v1/users/${userId}/mfa/${factorId}/reset`, { method: 'POST' });
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

export function listOrganizationInvitations(orgId) {
  return request(`/v1/organizations/${orgId}/invitations`);
}

export function createOrganizationInvitation(orgId, data) {
  return request(`/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateOrganizationInvitationStatus(orgId, invitationId, action) {
  return request(`/v1/organizations/${orgId}/invitations/${invitationId}/${action}`, { method: 'POST' });
}

export function getOrganizationJit(orgId) {
  return request(`/v1/organizations/${orgId}/jit`);
}

export function updateOrganizationJit(orgId, data) {
  return request(`/v1/organizations/${orgId}/jit`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function listOrganizationApplications(orgId) {
  return request(`/v1/organizations/${orgId}/applications`);
}

export function upsertOrganizationApplication(orgId, appId, data) {
  return request(`/v1/organizations/${orgId}/applications/${appId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
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

export function listRoleAssignments(roleId) {
  return request(`/v1/roles/${roleId}/assign`);
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

export function resolveSignInExperience(applicationId) {
  const qs = applicationId ? `?application_id=${encodeURIComponent(applicationId)}` : '';
  return request(`/v1/sign-in-experience/resolve${qs}`);
}

export function resolvePublicSignInExperience(params = {}) {
  const qs = new URLSearchParams();
  if (params.application_id) qs.set('application_id', params.application_id);
  if (params.authorization_id) qs.set('authorization_id', params.authorization_id);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request(`/v1/public/sign-in-experience/resolve${suffix}`);
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

export function getAuthConfigRuntimeConsistency() {
  return request('/v1/auth-config/runtime-consistency');
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

// Tenant config
export function listTenantConfigs(type) {
  const qs = type ? `?type=${encodeURIComponent(type)}` : '';
  return request(`/v1/tenant-config${qs}`);
}

export function upsertTenantConfig(type, key, data) {
  return request(`/v1/tenant-config/${encodeURIComponent(type)}/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteTenantConfig(type, key) {
  return request(`/v1/tenant-config/${encodeURIComponent(type)}/${encodeURIComponent(key)}`, { method: 'DELETE' });
}

export function checkTenantDomain(domain) {
  return request(`/v1/tenant-config/domain/${encodeURIComponent(domain)}/check`, { method: 'POST' });
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

export function listWebhookLogs(webhookId, limit = 50) {
  const qs = new URLSearchParams();
  if (limit) qs.set('limit', String(limit));
  return request(`/v1/webhooks/${webhookId}/logs${qs.toString() ? `?${qs.toString()}` : ''}`);
}

export function testWebhook(webhookId, data = {}) {
  return request(`/v1/webhooks/${webhookId}/test`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function replayWebhook(webhookId, data) {
  return request(`/v1/webhooks/${webhookId}/replay`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function listWebhookEvents() {
  return request('/v1/webhooks/events');
}

export function listAuditLogs(params = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      qs.set(key, String(value).trim());
    }
  }
  const query = qs.toString();
  return request(`/v1/audit${query ? `?${query}` : ''}`);
}

export function getAuditLog(logId) {
  return request(`/v1/audit/${logId}`);
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

// Consents
export function listUserConsents(userId) {
  return request(`/v1/consents?user_id=${encodeURIComponent(userId)}`);
}

export function grantConsent(data) {
  return request('/v1/consents', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function revokeConsent(consentId) {
  return request(`/v1/consents/${consentId}`, { method: 'DELETE' });
}

export function listApplicationConsents(applicationId) {
  return request(`/v1/consents/application/${applicationId}`);
}

// Organization templates
export function listOrgTemplates() {
  return request('/v1/org-templates');
}

export function createOrgTemplate(data) {
  return request('/v1/org-templates', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function deleteOrgTemplate(templateId) {
  return request(`/v1/org-templates/${templateId}`, { method: 'DELETE' });
}

export function instantiateOrgTemplate(templateId, data) {
  return request(`/v1/org-templates/${templateId}/instantiate`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Security and provisioning
export function getSecurityConfig() {
  return request('/v1/security-config');
}

export function updateSecurityConfig(data) {
  return request('/v1/security-config', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function getSecurityStatus() {
  return request('/v1/security-config/status');
}

export function getProvisioningStatus(projectRef) {
  return request(`/v1/provisioning/${projectRef}`);
}

export function reconcileProject(projectRef) {
  return request(`/v1/provisioning/${projectRef}/reconcile`, { method: 'POST' });
}

// Enterprise SSO and passkeys
export function listEnterpriseSSOConfigs() {
  return request('/v1/enterprise-sso');
}

export function createEnterpriseSSOConfig(data) {
  return request('/v1/enterprise-sso', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function listUserPasskeys(userId) {
  return request(`/v1/passkeys/${userId}`);
}
