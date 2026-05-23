// SupaOAuth Auth Server — Elysia/Bun Management API + BFF

import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import { getConfig, validateConfig } from './config/index.js';
import { getSupaCloudAdapter } from './supacloud/adapter.js';
import { checkRuntimeHealth, getDiscovery, getJWKS } from './runtime/index.js';
import { runCompatibilityChecks } from './compatibility/supabase.js';
import * as resourceRepo from './repositories/resources.js';
import * as orgRepo from './repositories/organizations.js';
import * as sieRepo from './repositories/sign-in-experience.js';
import * as auditRepo from './repositories/audit.js';
import * as webhookRepo from './repositories/webhooks.js';
import * as bindingRepo from './repositories/bindings.js';
import * as roleRepo from './repositories/roles.js';
import { dispatchEvent, buildEvent, SUPPORTED_WEBHOOK_EVENTS } from './repositories/webhook-delivery.js';
import { syncUserMetadata, syncOrgMetadata } from './sync/index.js';
import { authRoutes } from './auth/index.js';
import { observabilityMiddleware } from './middleware/index.js';
import { storageRoutes } from './storage/index.js';

const config = getConfig();
const configErrors = validateConfig(config);

if (configErrors.length > 0) {
  console.warn('SupaOAuth config warnings:', configErrors.join('; '));
}

const adapter = getSupaCloudAdapter();

// Audit helper — logs admin actions
async function audit(eventType: string, resourceType: string, resourceId: string, details?: Record<string, unknown>) {
  try {
    await auditRepo.logAudit({
      eventType,
      resourceType,
      resourceId,
      actorType: 'admin',
      details,
    });
  } catch {
    // Don't fail requests if audit logging fails
  }
}

// Webhook dispatch helper — fires webhook events for significant actions
async function fireWebhook(eventType: string, data: Record<string, unknown>) {
  try {
    const event = buildEvent(eventType, data);
    await dispatchEvent(event);
  } catch {
    // Don't fail requests if webhook dispatch fails
  }
}

const app = new Elysia()
  .use(observabilityMiddleware)
  .use(cors({ origin: config.corsOrigins, credentials: true }))
  .use(authRoutes)
  .use(storageRoutes)
  .use(swagger({
    path: '/swagger',
    documentation: {
      info: { title: 'SupaOAuth Management API', version: '0.1.0' },
    },
  }))

  // Health
  .get('/v1/health', () => ({
    status: 'ok',
    runtime_mode: config.runtimeMode,
    project_ref: config.projectRef || 'not configured',
  }))

  // Project
  .get('/v1/project', async () => adapter.getProject())

  // Runtime
  .get('/v1/runtime/health', async () => checkRuntimeHealth())
  .get('/v1/runtime/oauth-server', async () => adapter.getOAuthServerStatus())
  .get('/v1/runtime/discovery', async () => getDiscovery())
  .get('/v1/runtime/jwks', async () => getJWKS())

  // ─── Applications (proxy to GoTrue OAuth clients via SupaCloud) ───
  .get('/v1/applications', async () => {
    const res = await adapter.listOAuthClients();
    await audit('application.list', 'application', 'all');
    return res;
  })
  .post('/v1/applications', async ({ body }) => {
    const created = await adapter.createOAuthClient(body as Record<string, unknown>);
    const clientId = String((created as Record<string, unknown>).client_id);
    await audit('application.create', 'application', clientId, { name: (body as Record<string, unknown>).client_name });
    await fireWebhook('application.created', { client_id: clientId, client_name: (body as Record<string, unknown>).client_name });
    return created;
  })
  .get('/v1/applications/:appId', async ({ params }) => {
    return adapter.getOAuthClient(params.appId);
  })
  .put('/v1/applications/:appId', async ({ params, body }) => {
    const updated = await adapter.updateOAuthClient(params.appId, body as Record<string, unknown>);
    await audit('application.update', 'application', params.appId);
    await fireWebhook('application.updated', { client_id: params.appId });
    return updated;
  })
  .delete('/v1/applications/:appId', async ({ params }) => {
    await adapter.deleteOAuthClient(params.appId);
    await audit('application.delete', 'application', params.appId);
    await fireWebhook('application.deleted', { client_id: params.appId });
  })
  .post('/v1/applications/:appId/rotate-secret', async ({ params }) => {
    const result = await adapter.regenerateClientSecret(params.appId);
    await audit('application.rotate_secret', 'application', params.appId);
    return result;
  })

  // ─── Application-Resource/Scope bindings ───
  .get('/v1/applications/:appId/bindings', async ({ params }) => {
    const bindings = await bindingRepo.listApplicationBindings(params.appId);
    return { items: bindings, total: bindings.length };
  })
  .post('/v1/applications/:appId/bindings', async ({ params, body }) => {
    const data = body as { resource_id: string; scope_id?: string };
    const binding = await bindingRepo.createBinding({
      applicationId: params.appId,
      resourceId: data.resource_id,
      scopeId: data.scope_id,
    });
    await audit('binding.create', 'binding', binding.id, { app_id: params.appId, resource_id: data.resource_id });
    return binding;
  })
  .delete('/v1/applications/:appId/bindings/:bindingId', async ({ params }) => {
    await bindingRepo.deleteBinding(params.bindingId);
    await audit('binding.delete', 'binding', params.bindingId);
  })
  .get('/v1/applications/:appId/scopes', async ({ params }) => {
    const scopes = await bindingRepo.listApplicationScopes(params.appId);
    return { items: scopes, total: scopes.length };
  })

  // ─── Connectors (GoTrue providers + SupaOAuth metadata) ───
  .get('/v1/connectors', async () => adapter.listProviders())
  .get('/v1/connectors/:connectorId', async ({ params }) => {
    return adapter.getProvider(params.connectorId);
  })
  .patch('/v1/connectors/:connectorId', async ({ params, body }) => {
    const updated = await adapter.updateProvider(params.connectorId, body as Record<string, unknown>);
    await audit('connector.update', 'connector', params.connectorId);
    await fireWebhook('connector.updated', { connector_id: params.connectorId });
    return updated;
  })
  .post('/v1/connectors/:connectorId/test', async ({ params }) => {
    const provider = await adapter.getProvider(params.connectorId);
    return { connector_id: params.connectorId, status: provider ? 'reachable' : 'unreachable' };
  })

  // ─── API Resources (SupaOAuth metadata DB) ───
  .get('/v1/resources', async () => {
    const items = await resourceRepo.listResources();
    await audit('resource.list', 'resource', 'all');
    return { items, total: items.length };
  })
  .post('/v1/resources', async ({ body }) => {
    const created = await resourceRepo.createResource(body as { name: string; indicator: string; description?: string; scopes?: { name: string; description?: string }[] });
    await audit('resource.create', 'resource', created.id, { name: created.name });
    return created;
  })
  .get('/v1/resources/:resourceId', async ({ params }) => {
    const resource = await resourceRepo.getResource(params.resourceId);
    if (!resource) return new Response('Not found', { status: 404 });
    return resource;
  })
  .put('/v1/resources/:resourceId', async ({ params, body }) => {
    const updated = await resourceRepo.updateResource(params.resourceId, body as { name?: string; indicator?: string; description?: string });
    await audit('resource.update', 'resource', params.resourceId);
    return updated;
  })
  .delete('/v1/resources/:resourceId', async ({ params }) => {
    await resourceRepo.deleteResource(params.resourceId);
    await audit('resource.delete', 'resource', params.resourceId);
  })

  // ─── Scopes (under resources) ───
  .post('/v1/resources/:resourceId/scopes', async ({ params, body }) => {
    const scope = await resourceRepo.addScope(params.resourceId, body as { name: string; description?: string });
    await audit('scope.create', 'scope', scope.id, { resource_id: params.resourceId });
    return scope;
  })
  .delete('/v1/resources/:resourceId/scopes/:scopeId', async ({ params }) => {
    await resourceRepo.removeScope(params.scopeId);
    await audit('scope.delete', 'scope', params.scopeId);
  })

  // ─── Users (proxy to SupaCloud) ───
  .get('/v1/users', async () => adapter.listUsers())
  .get('/v1/users/:userId', async ({ params }) => adapter.getUser(params.userId))
  .delete('/v1/users/:userId', async ({ params }) => {
    await adapter.deleteUser(params.userId);
    await audit('user.delete', 'user', params.userId);
    await fireWebhook('user.deleted', { user_id: params.userId });
  })

  // ─── User role/permission resolution ───
  .get('/v1/users/:userId/permissions', async ({ params, query }) => {
    const orgId = query.org_id as string | undefined;
    const result = await roleRepo.resolveUserPermissions(params.userId, orgId);
    return result;
  })

  // ─── Organizations (SupaOAuth metadata DB) ───
  .get('/v1/organizations', async () => {
    const items = await orgRepo.listOrganizations();
    return { items, total: items.length };
  })
  .post('/v1/organizations', async ({ body }) => {
    const created = await orgRepo.createOrganization(body as { name: string; description?: string });
    await audit('organization.create', 'organization', created.id, { name: created.name });
    await fireWebhook('organization.created', { org_id: created.id, name: created.name });
    return created;
  })
  .get('/v1/organizations/:orgId', async ({ params }) => {
    const org = await orgRepo.getOrganization(params.orgId);
    if (!org) return new Response('Not found', { status: 404 });
    return org;
  })
  .put('/v1/organizations/:orgId', async ({ params, body }) => {
    const updated = await orgRepo.updateOrganization(params.orgId, body as { name?: string; description?: string });
    await audit('organization.update', 'organization', params.orgId);
    return updated;
  })
  .delete('/v1/organizations/:orgId', async ({ params }) => {
    await orgRepo.deleteOrganization(params.orgId);
    await audit('organization.delete', 'organization', params.orgId);
  })

  // ─── Organization Members ───
  .post('/v1/organizations/:orgId/members', async ({ params, body }) => {
    const data = body as { user_id: string; role?: string };
    const member = await orgRepo.addMember(params.orgId, data.user_id, data.role);
    await audit('organization.add_member', 'organization', params.orgId, { user_id: data.user_id });
    await fireWebhook('organization.member_added', { org_id: params.orgId, user_id: data.user_id });
    // Sync metadata to GoTrue
    await syncUserMetadata(data.user_id, params.orgId);
    return member;
  })
  .delete('/v1/organizations/:orgId/members/:userId', async ({ params }) => {
    await orgRepo.removeMember(params.orgId, params.userId);
    await audit('organization.remove_member', 'organization', params.orgId, { user_id: params.userId });
    await fireWebhook('organization.member_removed', { org_id: params.orgId, user_id: params.userId });
    await syncUserMetadata(params.userId);
  })
  .patch('/v1/organizations/:orgId/members/:userId', async ({ params, body }) => {
    const data = body as { role: string };
    const updated = await orgRepo.updateMemberRole(params.orgId, params.userId, data.role);
    await syncUserMetadata(params.userId, params.orgId);
    return updated;
  })

  // ─── Roles (SupaOAuth metadata DB) ───
  .get('/v1/roles', async () => {
    const items = await roleRepo.listRoles();
    return { items, total: items.length };
  })
  .post('/v1/roles', async ({ body }) => {
    const data = body as { name: string; description?: string };
    const created = await roleRepo.createRole(data);
    await audit('role.create', 'role', created.id, { name: created.name });
    return created;
  })
  .get('/v1/roles/:roleId', async ({ params }) => {
    const role = await roleRepo.getRole(params.roleId);
    if (!role) return new Response('Not found', { status: 404 });
    return role;
  })
  .put('/v1/roles/:roleId', async ({ params, body }) => {
    const updated = await roleRepo.updateRole(params.roleId, body as { name?: string; description?: string });
    await audit('role.update', 'role', params.roleId);
    return updated;
  })
  .delete('/v1/roles/:roleId', async ({ params }) => {
    await roleRepo.deleteRole(params.roleId);
    await audit('role.delete', 'role', params.roleId);
  })

  // ─── Permissions (under roles) ───
  .post('/v1/roles/:roleId/permissions', async ({ params, body }) => {
    const data = body as { name: string; description?: string; scope_id?: string };
    const perm = await roleRepo.createPermission({
      name: data.name,
      description: data.description,
      roleId: params.roleId,
      scopeId: data.scope_id,
    });
    await audit('permission.create', 'permission', perm.id, { role_id: params.roleId });
    return perm;
  })
  .delete('/v1/roles/:roleId/permissions/:permissionId', async ({ params }) => {
    await roleRepo.deletePermission(params.permissionId);
    await audit('permission.delete', 'permission', params.permissionId);
  })
  .get('/v1/roles/:roleId/permissions', async ({ params }) => {
    const permissions = await roleRepo.listRolePermissions(params.roleId);
    return { items: permissions, total: permissions.length };
  })

  // ─── Role Assignments ───
  .post('/v1/roles/:roleId/assign', async ({ params, body }) => {
    const data = body as { user_id: string; organization_id?: string; application_id?: string };
    const assignment = await roleRepo.assignRole({
      roleId: params.roleId,
      userId: data.user_id,
      organizationId: data.organization_id,
      applicationId: data.application_id,
    });
    await audit('role.assign', 'role_assignment', assignment.id, { role_id: params.roleId, user_id: data.user_id });
    await fireWebhook('role.assigned', { role_id: params.roleId, user_id: data.user_id });
    // Sync to GoTrue app_metadata
    await syncUserMetadata(data.user_id, data.organization_id);
    return assignment;
  })
  .delete('/v1/roles/:roleId/assign/:assignmentId', async ({ params }) => {
    await roleRepo.revokeRole(params.assignmentId);
    await audit('role.revoke', 'role_assignment', params.assignmentId);
    await fireWebhook('role.revoked', { role_id: params.roleId, assignment_id: params.assignmentId });
  })
  .get('/v1/users/:userId/roles', async ({ params }) => {
    const assignments = await roleRepo.getUserRoleAssignments(params.userId);
    return { items: assignments, total: assignments.length };
  })
  .get('/v1/organizations/:orgId/roles', async ({ params }) => {
    const assignments = await roleRepo.getOrgRoleAssignments(params.orgId);
    return { items: assignments, total: assignments.length };
  })

  // ─── Metadata sync ───
  .post('/v1/sync/user/:userId', async ({ params, query }) => {
    const orgId = query.org_id as string | undefined;
    const result = await syncUserMetadata(params.userId, orgId);
    return result;
  })
  .post('/v1/sync/org/:orgId', async ({ params }) => {
    const results = await syncOrgMetadata(params.orgId);
    return { results, total: results.length, failed: results.filter(r => !r.success).length };
  })

  // ─── Auth config (proxy to SupaCloud) ───
  .get('/v1/auth-config', async () => adapter.getAuthConfig())
  .patch('/v1/auth-config', async ({ body }) => {
    const updated = await adapter.updateAuthConfig(body as Record<string, unknown>);
    await audit('auth_config.update', 'auth_config', config.projectRef);
    return updated;
  })

  // ─── Sign-in Experience (SupaOAuth metadata DB) ───
  .get('/v1/sign-in-experience', async () => {
    return sieRepo.getSignInExperience();
  })
  .put('/v1/sign-in-experience', async ({ body }) => {
    const updated = await sieRepo.updateSignInExperience(body as Parameters<typeof sieRepo.updateSignInExperience>[0]);
    await audit('sign_in_experience.update', 'sign_in_experience', updated.id);
    return sieRepo.getSignInExperience();
  })

  // ─── Compatibility ───
  .get('/v1/compatibility/supabase', async () => {
    const results = await runCompatibilityChecks();
    return { checks: results, total: results.length, passed: results.filter(r => r.status === 'pass').length };
  })

  // ─── Audit logs (SupaOAuth metadata DB) ───
  .get('/v1/audit', async ({ query }) => {
    const options: Parameters<typeof auditRepo.queryAuditLogs>[0] = {};
    if (query.event_type) options.eventType = query.event_type as string;
    if (query.resource_type) options.resourceType = query.resource_type as string;
    if (query.resource_id) options.resourceId = query.resource_id as string;
    if (query.actor_id) options.actorId = query.actor_id as string;
    if (query.limit) options.limit = parseInt(query.limit as string, 10);
    if (query.offset) options.offset = parseInt(query.offset as string, 10);
    if (query.from) options.from = new Date(query.from as string);
    if (query.to) options.to = new Date(query.to as string);
    const items = await auditRepo.queryAuditLogs(options);
    return { items, total: items.length };
  })

  // ─── Webhooks (SupaOAuth metadata DB) ───
  .get('/v1/webhooks', async () => {
    const items = await webhookRepo.listWebhooks();
    return { items, total: items.length };
  })
  .post('/v1/webhooks', async ({ body }) => {
    const data = body as { url: string; events: string[]; enabled?: boolean };
    // Validate event types
    const invalid = data.events.filter(e => !SUPPORTED_WEBHOOK_EVENTS.includes(e as any) && e !== '*');
    if (invalid.length > 0) {
      return new Response(`Invalid event types: ${invalid.join(', ')}. Supported: ${SUPPORTED_WEBHOOK_EVENTS.join(', ')}, *`, { status: 400 });
    }
    const created = await webhookRepo.createWebhook(data);
    await audit('webhook.create', 'webhook', created.id, { url: created.url });
    return created;
  })
  .get('/v1/webhooks/:webhookId', async ({ params }) => {
    const webhook = await webhookRepo.getWebhook(params.webhookId);
    if (!webhook) return new Response('Not found', { status: 404 });
    return webhook;
  })
  .put('/v1/webhooks/:webhookId', async ({ params, body }) => {
    const updated = await webhookRepo.updateWebhook(params.webhookId, body as { url?: string; events?: string[]; enabled?: boolean });
    await audit('webhook.update', 'webhook', params.webhookId);
    return updated;
  })
  .delete('/v1/webhooks/:webhookId', async ({ params }) => {
    await webhookRepo.deleteWebhook(params.webhookId);
    await audit('webhook.delete', 'webhook', params.webhookId);
  })
  .post('/v1/webhooks/:webhookId/rotate-secret', async ({ params }) => {
    const updated = await webhookRepo.rotateWebhookSecret(params.webhookId);
    await audit('webhook.rotate_secret', 'webhook', params.webhookId);
    return updated;
  })
  .get('/v1/webhooks/events', () => ({
    events: SUPPORTED_WEBHOOK_EVENTS,
  }))

  .listen({ port: config.port, hostname: config.host });

console.log(`SupaOAuth Management API running at http://${config.host}:${config.port}`);
console.log(`Swagger docs at http://${config.host}:${config.port}/swagger`);
console.log(`Runtime mode: ${config.runtimeMode}`);
