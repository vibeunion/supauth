import { sdkEndpoints, type SdkEndpointName, type SdkEndpointInput, type SdkEndpointResult, type ExistingPolicy } from '@supauth/shared';

// Hand-authored protocol examples, independent of schema-driven value generation.
// Source: auth-server routes/repositories and SupaCloud management-api services.
const now = '2026-09-08T00:00:00.000Z';
export const health = { status: 'ok', runtime_mode: 'gotrue', project_ref: 'project-one' } as const;
export const user = {
  id: 'user-one', aud: 'authenticated', role: 'authenticated', email: 'member@example.test',
  app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { display_name: 'Member' },
  created_at: now, updated_at: now, email_confirmed_at: now, last_sign_in_at: null,
  identities: [{ id: 'identity-one', user_id: 'user-one', provider: 'email', identity_data: { email: 'member@example.test' } }],
  factors: [{ id: 'factor-one', factor_type: 'totp', status: 'verified', created_at: now }], is_anonymous: false,
};
export const oauth = { client_id: 'client-one', client_name: 'Console', client_type: 'public', redirect_uris: ['https://app.example.test/callback'], grant_types: ['authorization_code'], token_endpoint_auth_method: 'none', created_at: now, updated_at: now };
export const scope = { id: 'scope-one', name: 'documents.read', description: null, resourceId: 'resource-one' };
export const resource = { id: 'resource-one', name: 'Documents', indicator: 'https://api.example.test', description: null, createdAt: now, updatedAt: now, scopes: [scope] };
export const binding = { id: 'binding-one', applicationId: 'client-one', resourceId: 'resource-one', scopeId: 'scope-one', createdAt: now };
export const permission = { id: 'permission-one', name: 'documents.read', description: 'Read documents', scope_id: 'scope-one' };
export const role = { id: 'role-one', name: 'Reader', description: 'Read-only access', permissions: [permission] };
export const assignment = { id: 'assignment-one', role_id: 'role-one', user_id: 'user-one', organization_id: null, application_id: null, created_at: now };
export const organization = { id: 'org-one', name: 'Example', project_ref: 'project-one', slug: 'example', description: null, branding: { primary_color: '#008080' }, jit_enabled: false, jit_domains: [], created_at: now, updated_at: now };
export const member = { id: 'member-one', organization_id: 'org-one', user_id: 'user-one', role: 'member', created_at: now, updated_at: now };
export const invitation = { id: 'invitation-one', email: 'member@example.test', role: 'member', status: 'pending', token: 'test-invitation-token' };
export const orgApplication = { id: 'org-app-one', organization_id: 'org-one', application_id: 'client-one', created_at: now, created_by: null };
export const branding = { logo_url: 'https://example.test/logo.png', primary_color: '#008080' };
export const consent = { applicationId: 'client-one', userScopes: ['profile'], organizationScopes: [], allowedOrganizationIds: ['org-one'], requireExplicitConsent: true, customData: {} };
export const experience = { branding, sign_in_methods: ['email'], sign_up_enabled: true, password_policy: { min_length: 12, require_uppercase: true, require_lowercase: true, require_numbers: true, require_symbols: false } };
export const appExperience = { application_id: 'client-one', enabled: true, branding };
export const provider = { id: 'google', name: 'Google', type: 'social', enabled: true, provider_enabled: true, runtime_kind: 'builtin_oauth', configuration_required: false };
export const factory = { id: 'factory-one', factoryId: 'oidc', name: 'OIDC', protocol: 'oidc', category: 'enterprise_sso', configSchema: {}, enabled: true };
export const authConfig = { enable_signup: true, enable_confirmations: true, external_anonymous_users_enabled: false, jwt_expiry: 3600, password_min_length: 12, mfa_max_enrolled_factors: 10 };
export const config = { id: 'config-one', configType: 'domain', key: 'login', value: { hostname: 'login.example.test' }, enabled: true };
export const hook = { hook_name: 'custom-access-token', registered: true, verified: true, protocol: 'standard-webhooks-v1', version: '2.196.0', reason_code: null } as const;
export const tenantMember = { id: 'collaborator-one', project_ref: 'project-one', principal_id: 'principal-one', email: 'admin@example.test', role: 'admin', status: 'active', scope: 'project', capabilities: ['tenant.members.read'], created_at: now, updated_at: now } satisfies SdkEndpointResult<'updateTenantMember'>;
export const tenantInvitation = { id: 'collab-inv-one', project_ref: 'project-one', email: 'admin@example.test', role: 'admin', status: 'pending', scope: 'project', expires_at: now, created_at: now, updated_at: now } as const;
export const webhook = { id: 'webhook-one', url: 'https://events.example.test/hook', events: ['user.created'], has_secret: true, enabled: true, created_at: now, updated_at: now };
export const delivery = { id: 'delivery-one', outbox_id: 'outbox-one', project_ref: 'project-one', webhook_id: 'webhook-one', attempt: 1, status: 'delivered', status_code: 200, error: null, created_at: now, event_type: 'user.created', payload: { user_id: 'user-one' } } as const;
export const queued = { queued: true, outbox_id: 'outbox-one', event_id: 'event-one' } as const;
export const audit = { id: 'audit-one', event_type: 'user.created', actor_type: 'admin', actor_id: 'principal-one', resource_type: 'user', resource_id: 'user-one', details: { source: 'test' }, created_at: now } as const;
export const auditExport = { id: 'export-one', project_ref: 'project-one', actor: 'principal-one', format: 'jsonl', status: 'completed', row_count: 1, checksum: 'abc123', checkpoint_hash: null, filters: { eventType: null, resourceType: null, resourceId: null, actorId: null, status: null, method: null, from: null, to: null }, expires_at: now, created_at: now, completed_at: now, download_url: '/v1/audit/export/export-one/download' } as const;
export const integrity = { status: 'verified', consistent: true, reason: null, total_event_count: 1, verified_event_count: 1, checkpoint: { project_ref: 'project-one', last_event_id: 'audit-one', last_event_hash: 'abc123', event_count: '1', updated_at: now } } as const;
export const compiler = { generated_at: now, assumptions: ['JWT is verified'], warnings: [], permissions: ['documents.read'], sql: { helpers: 'SELECT 1;', tables: 'SELECT 1;', storage: '', realtime: '', rollback: '' }, edge_functions: [{ name: 'documents', permission: 'documents.read', middleware: 'authorize()', negative_tests: ['reject unauthorized'] }], negative_tests: ['reject unauthorized'], deploy_checklist: ['Review policies'] };
export const policy = { schemaname: 'public', tablename: 'documents', policyname: 'read_owned', policytype: 'permissive', cmd: 'SELECT', qual: 'owner_id = auth.uid()', with_check: null, roles: ['authenticated'] } satisfies ExistingPolicy;
export const migration = { scanned_policies: 1, candidate_policies: 1, wrappers: [{ original_policy: 'read_owned', wrapper_policy_name: 'read_owned_rbac', tablename: 'documents', schemaname: 'public', cmd: 'SELECT', original_using: 'owner_id = auth.uid()', original_with_check: null, wrapper_using: 'has_permission()', wrapper_with_check: null, sql: 'CREATE POLICY example;', permission_name: 'documents.read' }], migration_sql: 'CREATE POLICY example;', warnings: [] };
export const template = { id: 'template-one', name: 'Standard', description: null, templateRoles: [{ name: 'Reader', permissions: ['documents.read'] }], templateScopes: [{ name: 'documents.read' }], isDefault: false };
export const security = { admin_auth_mode: 'sso', token_auth_allowed: false, rate_limit_rpm: 300, brute_force_protection: true, enforce_https: true, warnings: [], warning_codes: [] };
export const provisioning = { project_ref: 'project-one', steps: [{ step: 'gotrue_config', status: 'completed', details: {} }], fully_provisioned: false } satisfies SdkEndpointResult<'getProvisioningStatus'>;
export const sso = { id: 'sso-one', connectorId: 'connector-one', domains: ['example.test'], ssoProtocol: 'saml', jitProvisioning: false, orgMembershipMapping: {}, roleMapping: {} };
const list = <T>(item: T) => ({ items: [item], total: 1, page: 1, limit: 50 });
const cursor = <T>(item: T) => ({ ...list(item), next_cursor: null });

export const responses = {
  health, getProject: { id: 'project-id', ref: 'project-one', name: 'Project' },
  getCapabilities: { runtime_mode: 'gotrue', capabilities: { rbac: { available: true, reason_code: null, source: 'supacloud', version: null, last_verified_at: now } } },
  getRuntimeHealth: { discovery: true, jwks: true, authorize: true, token: true, userinfo: true, issuer: 'https://auth.example.test', signing_alg: 'RS256' },
  getOAuthServerStatus: { enabled: true, signing_alg: 'RS256', allow_dynamic_registration: false },
  getDiscovery: { issuer: 'https://auth.example.test', authorization_endpoint: 'https://auth.example.test/authorize', token_endpoint: 'https://auth.example.test/token', userinfo_endpoint: 'https://auth.example.test/userinfo', jwks_uri: 'https://auth.example.test/jwks', scopes_supported: ['openid'] },
  getJWKS: { keys: [{ kty: 'RSA', kid: 'key-one', n: 'public-modulus', e: 'AQAB' }] },
  listApplications: list(oauth), createApplication: oauth, getApplication: oauth, updateApplication: oauth,
  deleteApplication: undefined, rotateApplicationSecret: { client_id: 'client-one', client_secret: 'one-time-test-secret' },
  getApplicationConsentSettings: consent, updateApplicationConsentSettings: consent,
  getApplicationSignInExperience: appExperience, updateApplicationSignInExperience: appExperience, deleteApplicationSignInExperience: undefined,
  listApplicationBindings: list(binding), createApplicationBinding: binding, deleteApplicationBinding: undefined,
  listApplicationScopes: list({ bindingId: 'binding-one', resourceId: 'resource-one', scope }),
  listApplicationRoles: list(assignment), listApplicationLogs: cursor(audit), listApplicationOrganizations: list(organization),
  getApplicationAccessControl: consent, updateApplicationAccessControl: consent,
  listConnectors: list(provider), getConnector: provider, updateConnector: provider,
  testConnector: { status: 'reachable', check_kind: 'runtime_configuration', runtime_kind: 'builtin_oauth', authorization_url: 'https://provider.example.test/authorize' },
  getConnectorAuthorizationUri: { connector_id: 'google', authorization_uri: 'https://provider.example.test/authorize' },
  listConnectorFactories: list(factory), upsertConnectorFactory: factory,
  listResources: list(resource), createResource: resource, getResource: resource, updateResource: resource, deleteResource: undefined,
  addScope: scope, updateScope: scope, removeScope: undefined, listResourceApplications: list(binding),
  listUsers: list(user), createUser: user, getUser: user, updateUser: user, suspendUser: user, deleteUser: undefined,
  resetUserMfa: { reset: true, factor_id: 'factor-one', result: { id: 'factor-one' } },
  listUserLogs: cursor(audit), listUserOrganizations: list(organization),
  getUserPermissions: { roles: ['Reader'], permissions: ['documents.read'], scopes: ['documents.read'] }, getUserRoles: list(assignment),
  listOrganizations: list(organization), createOrganization: organization, getOrganization: organization, updateOrganization: organization, deleteOrganization: undefined,
  addOrganizationMember: member, listOrganizationMembers: list(member), removeOrganizationMember: undefined, updateOrganizationMemberRole: member,
  listOrganizationInvitations: list(invitation), createOrganizationInvitation: invitation, acceptOrganizationInvitation: member,
  revokeOrganizationInvitation: { revoked: true, invitation },
  getOrganizationJitSettings: { enabled: false, domains: [] }, updateOrganizationJitSettings: { enabled: false, domains: [] },
  listOrganizationApplications: list(orgApplication), bindOrganizationApplication: orgApplication, removeOrganizationApplication: { deleted: true, binding: orgApplication },
  getOrganizationBranding: branding, updateOrganizationBranding: branding,
  listRoles: list(role), createRole: role, getRole: role, updateRole: role, deleteRole: undefined,
  listRolePermissions: list(permission), createRolePermission: permission, deleteRolePermission: undefined,
  assignRole: assignment, listRoleAssignments: list(assignment), revokeRole: undefined, getOrgRoleAssignments: list(assignment),
  getSignInExperience: experience, resolveSignInExperience: experience, resolvePublicSignInExperience: { ...experience, connectors: [{ id: 'google', name: 'Google', type: 'social' }] },
  getPublicPhrases: { language_tag: 'zh-CN', phrases: { welcome: 'Welcome' } }, updateSignInExperience: experience,
  getAuthConfig: authConfig, updateAuthConfig: authConfig,
  getCompatibilityReport: { checks: [{ check_id: 'runtime', status: 'pass', message: 'Supported' }], total: 1, passed: 1 },
  listTenantConfigs: list(config), getTenantConfig: config, upsertTenantConfig: config, deleteTenantConfig: config,
  checkTenantDomain: { domain: 'login.example.test', status: 'unknown', checked_at: now, error: 'upstream unavailable' },
  getAuthHookRegistrationGuide: { before_user_created: 'https://auth.example.test/v1/auth-hooks/before-user-created', custom_access_token: 'https://auth.example.test/v1/auth-hooks/custom-access-token', protocol: 'standard-webhooks-v1', required_headers: ['webhook-id', 'webhook-timestamp', 'webhook-signature'], secret_format: 'v1,whsec_<base64>' },
  getAuthHookStatus: hook, verifyAuthHook: hook, getBeforeUserCreatedHookStatus: { ...hook, hook_name: 'before-user-created' }, verifyBeforeUserCreatedHook: { ...hook, hook_name: 'before-user-created' },
  listTenantMembers: list(tenantMember), updateTenantMember: tenantMember, removeTenantMember: undefined,
  listTenantInvitations: list(tenantInvitation), createTenantInvitation: tenantInvitation,
  listWebhooks: list(webhook), createWebhook: webhook, getWebhook: webhook, updateWebhook: webhook, deleteWebhook: undefined, rotateWebhookSecret: webhook,
  listWebhookLogs: cursor(delivery), testWebhook: queued,
  listWebhookEvents: { events: ['user.created'], catalog: [{ type: 'user.created', guarantee: 'post_mutation' }] },
  listWebhookDeliveries: cursor(delivery), getWebhookDelivery: delivery, replayWebhookDelivery: { ...queued, original_delivery_id: 'delivery-one' },
  syncUserMetadata: { synced: true }, syncOrgMetadata: { results: [{ synced: true }], total: 1, failed: 0 },
  listAuditLogs: cursor(audit), getAuditLog: audit, createAuditExport: auditExport, getAuditExport: auditExport, getAuditExportDownload: 'export-content',
  getAuditIntegrity: integrity, compileAuthorizationPlan: compiler, getAuthorizationCompilerDemo: compiler,
  generateRLSMigration: migration, getRLSMigrationDemo: migration,
  listOrgTemplates: list(template), createOrgTemplate: template, instantiateOrgTemplate: { org: organization, template, rolesCreated: 1 },
  getSecurityStatus: security, getProvisioningStatus: provisioning, reconcileProject: { project_ref: 'project-one', results: [...provisioning.steps], fully_provisioned: false },
  listEnterpriseSSOConfigs: list(sso), createEnterpriseSSOConfig: sso,
} satisfies { [K in SdkEndpointName]: SdkEndpointResult<K> };

export function responseForRequest(url: string, method = 'GET'): unknown {
  const path = new URL(url).pathname;
  for (const [name, endpoint] of Object.entries(sdkEndpoints)) {
    if (endpoint.method !== method) continue;
    const pattern = new RegExp(`^${endpoint.path.replace(/:[A-Za-z]+/g, '[^/]+')}$`);
    if (pattern.test(path)) {
      const response = Object.entries(responses).find(([key]) => key === name);
      if (!response) throw new Error(`Missing response fixture for ${name}`);
      return response[1];
    }
  }
  throw new Error(`No protocol fixture for ${method} ${path}`);
}

export const bodies = {
  createApplication: { name: 'Console', type: 'spa', redirect_uris: ['https://app.example.test/callback'] },
  updateApplication: { client_name: 'Console' },
  updateApplicationConsentSettings: { user_scopes: ['profile'] }, updateApplicationAccessControl: { require_explicit_consent: true },
  updateApplicationSignInExperience: { enabled: true, branding },
  createApplicationBinding: { resource_id: 'resource-one', scope_id: 'scope-one' },
  updateConnector: { enabled: true }, upsertConnectorFactory: { name: 'OIDC', protocol: 'oidc', category: 'enterprise_sso', enabled: true },
  createResource: { name: 'Documents', indicator: 'https://api.example.test', scopes: [{ name: 'documents.read' }] },
  updateResource: { name: 'Documents' }, addScope: { name: 'documents.read' }, updateScope: { name: 'documents.read' },
  createUser: { email: 'member@example.test', user_metadata: { display_name: 'Member' } },
  updateUser: { user_metadata: { display_name: 'Updated' } }, suspendUser: { ban_duration: '24h' },
  createOrganization: { name: 'Example' }, updateOrganization: { name: 'Example' }, addOrganizationMember: { user_id: 'user-one', role: 'member' },
  updateOrganizationMemberRole: { role: 'member' }, createOrganizationInvitation: { email: 'member@example.test', role: 'member' },
  acceptOrganizationInvitation: { token: 'test-invitation-token' }, updateOrganizationJitSettings: { enabled: false, domains: [] },
  updateOrganizationBranding: branding, createRole: { name: 'Reader' }, updateRole: { name: 'Reader' },
  createRolePermission: { name: 'documents.read' }, assignRole: { user_id: 'user-one' },
  updateSignInExperience: { sign_up_enabled: true }, updateAuthConfig: { enable_signup: true },
  upsertTenantConfig: { value: { hostname: 'login.example.test' }, enabled: true },
  updateTenantMember: { role: 'admin' }, createTenantInvitation: { email: 'admin@example.test', role: 'viewer' },
  createWebhook: { url: 'https://events.example.test/hook', events: ['user.created'] }, updateWebhook: { enabled: true },
  createAuditExport: { format: 'jsonl', limit: 50 }, compileAuthorizationPlan: { tables: [{ table: 'documents', operations: ['read'] }] },
  generateRLSMigration: { policies: [policy] }, createOrgTemplate: { name: 'Standard', template_roles: [{ name: 'Reader', permissions: ['documents.read'] }] },
  instantiateOrgTemplate: { name: 'Example', creator_user_id: 'user-one' },
  createEnterpriseSSOConfig: { connector_id: 'connector-one', domains: ['example.test'] },
} satisfies Partial<{ [K in SdkEndpointName]: 'body' extends keyof SdkEndpointInput<K> ? SdkEndpointInput<K>['body'] : never }>;
