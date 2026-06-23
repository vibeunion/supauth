export const SUPACLOUD_OWNED_MANAGEMENT_DOMAINS = [
  'applications',
  'application_secrets',
  'users',
  'user_sessions',
  'user_identities',
  'user_mfa',
  'user_passkeys',
  'organizations',
  'organization_members',
  'organization_invitations',
  'organization_jit',
  'organization_applications',
  'rbac_roles',
  'rbac_permissions',
  'rbac_assignments',
  'audit',
  'webhooks',
  'webhook_delivery',
  'providers',
] as const;

export const SUPAUTH_OVERLAY_DOMAINS = [
  'hosted_auth_pages',
  'account_center_pages',
  'account_claim_pages',
  'sign_in_experience_overrides',
  'connector_visibility_overrides',
  'oauth_consents',
  'api_resources',
  'api_resource_bindings',
  'tenant_branding_assets',
  'tenant_phrases',
  'custom_profile_fields',
  'compatibility_helpers',
  'organization_templates',
  'enterprise_sso_mapping',
  'account_provisioning_records',
] as const;

export const SUPACLOUD_MANAGED_BACKGROUND_JOBS = [
  {
    name: 'webhook-delivery',
    owner: 'supacloud',
    trigger: 'POST /v1/projects/{projectRef}/webhooks/events',
    description: 'SupaCloud signs, retries, records diagnostics, and disables failing webhooks.',
  },
  {
    name: 'account-provisioning-import',
    owner: 'supacloud-function',
    trigger: 'POST /api/v1/account-provisioning/import',
    description: 'Runs inside the SupAuth Function handler; no standalone import service is required.',
  },
] as const;

export const FORBIDDEN_RUNTIME_FORMS = [
  'standalone-http-server',
  'systemd-service',
  'pm2-process',
  'webhook-worker-process',
  'cron-process-owned-by-supauth',
] as const;

export const SUPAOAUTH_TABLE_OWNERSHIP = {
  api_resources: { class: 'supauth-overlay', domain: 'api_resources' },
  scopes: { class: 'supauth-overlay', domain: 'api_resources' },
  organizations: { class: 'legacy-temporary', replacement: 'supacloud-management-api:organizations' },
  organization_members: { class: 'legacy-temporary', replacement: 'supacloud-management-api:organization_members' },
  roles: { class: 'legacy-temporary', replacement: 'supacloud-management-api:rbac_roles' },
  permissions: { class: 'legacy-temporary', replacement: 'supacloud-management-api:rbac_permissions' },
  sign_in_experience: { class: 'supauth-overlay', domain: 'sign_in_experience_overrides' },
  application_sign_in_experience: { class: 'supauth-overlay', domain: 'sign_in_experience_overrides' },
  audit_logs: { class: 'legacy-temporary', replacement: 'supacloud-management-api:audit' },
  webhooks: { class: 'legacy-temporary', replacement: 'supacloud-management-api:webhooks' },
  webhook_deliveries: { class: 'legacy-temporary', replacement: 'supacloud-management-api:webhook_delivery' },
  connectors: { class: 'supauth-overlay', domain: 'connector_visibility_overrides' },
  application_bindings: { class: 'supauth-overlay', domain: 'api_resource_bindings' },
  role_assignments: { class: 'legacy-temporary', replacement: 'supacloud-management-api:rbac_assignments' },
  user_consents: { class: 'supauth-overlay', domain: 'oauth_consents' },
  organization_templates: { class: 'supauth-overlay', domain: 'organization_templates' },
  provisioning_records: { class: 'legacy-temporary', replacement: 'supacloud-app-install-state' },
  security_config: { class: 'supauth-overlay', domain: 'compatibility_helpers' },
  enterprise_sso_config: { class: 'supauth-overlay', domain: 'enterprise_sso_mapping' },
  passkeys: { class: 'legacy-temporary', replacement: 'supacloud-management-api:user_passkeys' },
  api_version_log: { class: 'supauth-overlay', domain: 'compatibility_helpers' },
  application_secrets: { class: 'legacy-temporary', replacement: 'supacloud-management-api:application_secrets' },
  application_consent_settings: { class: 'supauth-overlay', domain: 'oauth_consents' },
  account_sessions: { class: 'legacy-temporary', replacement: 'supacloud-management-api:user_sessions' },
  account_provisioning_records: { class: 'supauth-overlay', domain: 'account_provisioning_records' },
  organization_invitations: { class: 'legacy-temporary', replacement: 'supacloud-management-api:organization_invitations' },
  organization_jit_settings: { class: 'legacy-temporary', replacement: 'supacloud-management-api:organization_jit' },
  organization_applications: { class: 'legacy-temporary', replacement: 'supacloud-management-api:organization_applications' },
  connector_factories: { class: 'supauth-overlay', domain: 'connector_visibility_overrides' },
  tenant_configs: { class: 'supauth-overlay', domain: 'tenant_branding_assets' },
} as const;

export function createSupacloudAppManifest(input: {
  functionBundle: string;
  adminStaticDir: string;
  openapiPath: string;
}) {
  return {
    schema_version: 1,
    app_id: 'supauth',
    name: 'SupAuth',
    install_mode: 'supacloud-project-scoped',
    http_runtime: 'supacloud-functions-only',
    source_of_truth: 'supacloud-management-api',
    supacloud_owned_management_domains: SUPACLOUD_OWNED_MANAGEMENT_DOMAINS,
    supauth_overlay_domains: SUPAUTH_OVERLAY_DOMAINS,
    supacloud_managed_background_jobs: SUPACLOUD_MANAGED_BACKGROUND_JOBS,
    forbidden_runtime_forms: FORBIDDEN_RUNTIME_FORMS,
    supaoauth_table_ownership: SUPAOAUTH_TABLE_OWNERSHIP,
    created_at: new Date().toISOString(),
    artifacts: {
      function_bundle: input.functionBundle,
      admin_static_dir: input.adminStaticDir,
      openapi: input.openapiPath,
    },
    required_supacloud_env: [
      { name: 'SUPACLOUD_INTERNAL_API_URL', secret: false, description: 'Project-scoped SupaCloud Management API base URL.' },
      { name: 'SUPACLOUD_INTERNAL_TOKEN', secret: true, description: 'Project-scoped internal token for server-side SupaCloud API calls.' },
      { name: 'SUPACLOUD_PROJECT_REF', secret: false, description: 'Current SupaCloud project ref.' },
      { name: 'SUPACLOUD_RUNTIME_URL', secret: false, description: 'Public Supabase-compatible runtime URL for the project.' },
      { name: 'SUPACLOUD_RUNTIME_INTERNAL_URL', secret: false, optional: true, description: 'Internal GoTrue/runtime URL when different from the public runtime URL.' },
      { name: 'SUPACLOUD_DATABASE_URL', secret: true, description: 'Project database URL for SupAuth overlay tables and migrations.' },
    ],
    pages: [
      {
        name: 'supauth-admin',
        source_dir: input.adminStaticDir,
        routes: ['/admin/*'],
        fallback: '/admin/index.html',
      },
    ],
    functions: [
      {
        name: 'supauth',
        runtime: 'bun',
        entrypoint: input.functionBundle,
        routes: [
          { path: '/api/*', strip_prefix: '/api' },
          { path: '/v1/*' },
          { path: '/v1/public/*' },
          { path: '/oauth/*' },
          { path: '/login.html' },
          { path: '/authorize.html' },
          { path: '/account' },
          { path: '/account.html' },
          { path: '/account/*' },
          { path: '/change-password' },
          { path: '/change-password.html' },
          { path: '/claim' },
          { path: '/claim.html' },
          { path: '/favicon.ico' },
          { path: '/favicon.svg' },
          { path: '/admin/api/*', strip_prefix: '/admin/api' },
          { path: '/' },
        ],
      },
    ],
    preserved_runtime_routes: [
      '/auth/v1/*',
      '/rest/v1/*',
      '/storage/v1/*',
      '/realtime/v1/*',
      '/functions/v1/*',
    ],
    migrations: [
      {
        name: 'supauth-overlay-schema',
        command: 'SupaCloud Management API POST /v1/projects/{projectRef}/database/migrations',
        database_env: 'SUPACLOUD_DATABASE_URL',
      },
      {
        name: 'supauth-overlay-project-role-grants',
        command: 'SupaCloud hosted migration grant step',
        database_env: 'SUPACLOUD_DATABASE_URL',
      },
    ],
  };
}
