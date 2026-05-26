// Migration script — creates the `supaoauth` schema and tables on SupaCloud's Postgres

import postgres from 'postgres';

const MIGRATION_SQL = `
-- Create supaoauth schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS supaoauth;

-- API Resources
CREATE TABLE IF NOT EXISTS supaoauth.api_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  indicator VARCHAR(1024) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_resources_indicator ON supaoauth.api_resources (indicator);

-- Scopes
CREATE TABLE IF NOT EXISTS supaoauth.scopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  resource_id UUID NOT NULL REFERENCES supaoauth.api_resources(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scopes_resource_id ON supaoauth.scopes (resource_id);

-- Organizations
CREATE TABLE IF NOT EXISTS supaoauth.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Organization Members
CREATE TABLE IF NOT EXISTS supaoauth.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES supaoauth.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role VARCHAR(100) NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON supaoauth.organization_members (organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON supaoauth.organization_members (user_id);

-- Roles
CREATE TABLE IF NOT EXISTS supaoauth.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Permissions
CREATE TABLE IF NOT EXISTS supaoauth.permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  role_id UUID NOT NULL REFERENCES supaoauth.roles(id) ON DELETE CASCADE,
  scope_id UUID REFERENCES supaoauth.scopes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_permissions_role_id ON supaoauth.permissions (role_id);

-- Sign-in Experience
CREATE TABLE IF NOT EXISTS supaoauth.sign_in_experience (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  logo_url TEXT,
  favicon_url TEXT,
  primary_color VARCHAR(32),
  page_title VARCHAR(255),
  sign_in_methods JSONB DEFAULT '[]'::jsonb,
  sign_up_enabled BOOLEAN NOT NULL DEFAULT true,
  mfa_required BOOLEAN NOT NULL DEFAULT false,
  password_min_length INTEGER NOT NULL DEFAULT 8,
  password_require_uppercase BOOLEAN NOT NULL DEFAULT false,
  password_require_lowercase BOOLEAN NOT NULL DEFAULT false,
  password_require_numbers BOOLEAN NOT NULL DEFAULT false,
  password_require_symbols BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit Logs
CREATE TABLE IF NOT EXISTS supaoauth.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(255) NOT NULL,
  actor_id UUID,
  actor_type VARCHAR(50) NOT NULL DEFAULT 'system',
  resource_type VARCHAR(255) NOT NULL,
  resource_id VARCHAR(255) NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON supaoauth.audit_logs (event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON supaoauth.audit_logs (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON supaoauth.audit_logs (created_at);

-- Webhooks
CREATE TABLE IF NOT EXISTS supaoauth.webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  events JSONB NOT NULL,
  secret TEXT NOT NULL,
  signing_key_id VARCHAR(255),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE supaoauth.webhooks ADD COLUMN IF NOT EXISTS signing_key_id VARCHAR(255);

-- Connectors (SupaOAuth metadata overlay on GoTrue providers)
CREATE TABLE IF NOT EXISTS supaoauth.connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  config JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connectors_provider_id ON supaoauth.connectors (provider_id);

-- Application-Resource/Scope Bindings
CREATE TABLE IF NOT EXISTS supaoauth.application_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id VARCHAR(255) NOT NULL, -- GoTrue OAuth client_id
  resource_id UUID NOT NULL REFERENCES supaoauth.api_resources(id) ON DELETE CASCADE,
  scope_id UUID REFERENCES supaoauth.scopes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_bindings_app_id ON supaoauth.application_bindings (application_id);
CREATE INDEX IF NOT EXISTS idx_app_bindings_resource_id ON supaoauth.application_bindings (resource_id);

-- Role Assignments (user-level, org-level, M2M app-level)
CREATE TABLE IF NOT EXISTS supaoauth.role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES supaoauth.roles(id) ON DELETE CASCADE,
  user_id UUID, -- references auth.users.id; null for M2M assignments
  organization_id UUID REFERENCES supaoauth.organizations(id) ON DELETE CASCADE, -- null = user-level
  application_id VARCHAR(255), -- null = not app-scoped; GoTrue client_id for M2M
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_role_assignments_role_id ON supaoauth.role_assignments (role_id);
CREATE INDEX IF NOT EXISTS idx_role_assignments_user_id ON supaoauth.role_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_role_assignments_org_id ON supaoauth.role_assignments (organization_id);

-- Supabase-compatible RBAC projection helpers
--
-- These helpers let existing Supabase projects migrate RLS incrementally:
--   USING (auth.uid() = owner_id OR supaoauth.authorize('project.read'))
--
-- The JWT role claim remains authenticated; business RBAC is resolved from
-- supaoauth metadata tables so permission revocation does not wait for token
-- refresh. SECURITY DEFINER is required because authenticated users should not
-- get direct table privileges on supaoauth metadata tables.
CREATE OR REPLACE FUNCTION supaoauth.authorize(permission_name TEXT, target_organization_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = supaoauth, public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM supaoauth.role_assignments ra
    JOIN supaoauth.permissions p ON p.role_id = ra.role_id
    WHERE ra.user_id = auth.uid()
      AND p.name = permission_name
      AND (
        target_organization_id IS NULL
        OR ra.organization_id IS NULL
        OR ra.organization_id = target_organization_id
      )
  );
$$;

CREATE OR REPLACE FUNCTION supaoauth.has_org_permission(organization_id UUID, permission_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = supaoauth, public, auth
AS $$
  SELECT supaoauth.authorize(permission_name, organization_id);
$$;

CREATE OR REPLACE FUNCTION supaoauth.app_has_org_permission(client_id TEXT, organization_id UUID, permission_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = supaoauth, public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM supaoauth.role_assignments ra
    JOIN supaoauth.permissions p ON p.role_id = ra.role_id
    WHERE ra.application_id = client_id
      AND (ra.organization_id IS NULL OR ra.organization_id = organization_id)
      AND p.name = permission_name
  );
$$;

REVOKE ALL ON FUNCTION supaoauth.authorize(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION supaoauth.has_org_permission(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION supaoauth.app_has_org_permission(TEXT, UUID, TEXT) FROM PUBLIC;
GRANT USAGE ON SCHEMA supaoauth TO authenticated;
GRANT EXECUTE ON FUNCTION supaoauth.authorize(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION supaoauth.has_org_permission(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION supaoauth.app_has_org_permission(TEXT, UUID, TEXT) TO authenticated;

-- Insert default sign-in experience row if empty
INSERT INTO supaoauth.sign_in_experience (page_title, sign_up_enabled, mfa_required)
SELECT 'SupaOAuth', true, false
WHERE NOT EXISTS (SELECT 1 FROM supaoauth.sign_in_experience);
`;

export async function runMigration() {
  const url = process.env.DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL is required for migration');
  const sql = postgres(url, { max: 1 });

  try {
    await sql.unsafe(MIGRATION_SQL);
    await sql.unsafe(MIGRATION_V2_SQL);
    console.log('SupaOAuth schema migration completed');
  } catch (e) {
    console.error('Migration failed:', e);
    throw e;
  } finally {
    await sql.end();
  }
}

// ─── V2 Migration: P0-17 through P1-10 tables ─────────────────────────────

const MIGRATION_V2_SQL = `
-- User Consents (P0-17)
ALTER TABLE supaoauth.role_assignments ALTER COLUMN user_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS supaoauth.user_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  application_id VARCHAR(255) NOT NULL,
  scope_id UUID REFERENCES supaoauth.scopes(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES supaoauth.organizations(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_user_consents_user_id ON supaoauth.user_consents (user_id);
CREATE INDEX IF NOT EXISTS idx_user_consents_app_id ON supaoauth.user_consents (application_id);
CREATE INDEX IF NOT EXISTS idx_user_consents_org_id ON supaoauth.user_consents (organization_id);

-- Organization Templates (P0-18)
CREATE TABLE IF NOT EXISTS supaoauth.organization_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  template_roles JSONB DEFAULT '[]'::jsonb,
  template_scopes JSONB DEFAULT '[]'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Provisioning Records (P0-20)
CREATE TABLE IF NOT EXISTS supaoauth.provisioning_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_ref VARCHAR(255) NOT NULL,
  step VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_provisioning_project_ref ON supaoauth.provisioning_records (project_ref);
CREATE INDEX IF NOT EXISTS idx_provisioning_step ON supaoauth.provisioning_records (step);

-- Security Config (P0-19)
CREATE TABLE IF NOT EXISTS supaoauth.security_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_auth_mode VARCHAR(50) NOT NULL DEFAULT 'auto',
  admin_allowed_emails JSONB DEFAULT '[]'::jsonb,
  admin_allowed_domains JSONB DEFAULT '[]'::jsonb,
  rate_limit_rpm INTEGER NOT NULL DEFAULT 300,
  rate_limit_burst INTEGER NOT NULL DEFAULT 50,
  brute_force_protection BOOLEAN NOT NULL DEFAULT true,
  max_login_attempts INTEGER NOT NULL DEFAULT 10,
  lockout_duration_sec INTEGER NOT NULL DEFAULT 900,
  secret_rotation_reminder_days INTEGER NOT NULL DEFAULT 90,
  enforce_https BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enterprise SSO Config (P1-9)
CREATE TABLE IF NOT EXISTS supaoauth.enterprise_sso_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id UUID NOT NULL REFERENCES supaoauth.connectors(id) ON DELETE CASCADE,
  domains JSONB NOT NULL,
  sso_protocol VARCHAR(50) NOT NULL DEFAULT 'oidc',
  jit_provisioning BOOLEAN NOT NULL DEFAULT false,
  org_membership_mapping JSONB DEFAULT '{}'::jsonb,
  role_mapping JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_enterprise_sso_connector_id ON supaoauth.enterprise_sso_config (connector_id);

-- Passkeys (P1-9)
CREATE TABLE IF NOT EXISTS supaoauth.passkeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  credential_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  device_type VARCHAR(100),
  backed_up BOOLEAN NOT NULL DEFAULT false,
  name VARCHAR(255),
  transports JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_passkeys_user_id ON supaoauth.passkeys (user_id);

-- API Version Log (P1-10)
CREATE TABLE IF NOT EXISTS supaoauth.api_version_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version VARCHAR(50) NOT NULL,
  change_type VARCHAR(50) NOT NULL,
  path VARCHAR(500) NOT NULL,
  method VARCHAR(10) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_version_log_version ON supaoauth.api_version_log (version);

-- Application Secrets / Consent Configuration (P0-24)
CREATE TABLE IF NOT EXISTS supaoauth.application_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id VARCHAR(255) NOT NULL,
  secret_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_application_secrets_app_id ON supaoauth.application_secrets (application_id);
CREATE INDEX IF NOT EXISTS idx_application_secrets_secret_id ON supaoauth.application_secrets (secret_id);

CREATE TABLE IF NOT EXISTS supaoauth.application_consent_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id VARCHAR(255) NOT NULL,
  user_scopes JSONB DEFAULT '[]'::jsonb,
  organization_scopes JSONB DEFAULT '[]'::jsonb,
  allowed_organization_ids JSONB DEFAULT '[]'::jsonb,
  require_explicit_consent BOOLEAN NOT NULL DEFAULT true,
  custom_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_application_consent_settings_app_id ON supaoauth.application_consent_settings (application_id);

-- Account Center / Organization B2B Control Plane (P1-12/P1-13)
CREATE TABLE IF NOT EXISTS supaoauth.account_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  session_id VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_account_sessions_user_id ON supaoauth.account_sessions (user_id);

CREATE TABLE IF NOT EXISTS supaoauth.organization_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES supaoauth.organizations(id) ON DELETE CASCADE,
  email VARCHAR(320) NOT NULL,
  role VARCHAR(100) NOT NULL DEFAULT 'member',
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_org_invitations_org_id ON supaoauth.organization_invitations (organization_id);
CREATE INDEX IF NOT EXISTS idx_org_invitations_email ON supaoauth.organization_invitations (email);

CREATE TABLE IF NOT EXISTS supaoauth.organization_jit_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES supaoauth.organizations(id) ON DELETE CASCADE,
  email_domains JSONB DEFAULT '[]'::jsonb,
  sso_connector_ids JSONB DEFAULT '[]'::jsonb,
  default_role_ids JSONB DEFAULT '[]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_org_jit_settings_org_id ON supaoauth.organization_jit_settings (organization_id);

CREATE TABLE IF NOT EXISTS supaoauth.organization_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES supaoauth.organizations(id) ON DELETE CASCADE,
  application_id VARCHAR(255) NOT NULL,
  role_ids JSONB DEFAULT '[]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_org_apps_org_id ON supaoauth.organization_applications (organization_id);
CREATE INDEX IF NOT EXISTS idx_org_apps_app_id ON supaoauth.organization_applications (application_id);

-- Connector Factory / Tenant UX Configuration (P1-14/P1-16)
CREATE TABLE IF NOT EXISTS supaoauth.connector_factories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  protocol VARCHAR(50) NOT NULL,
  category VARCHAR(100) NOT NULL,
  config_schema JSONB DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connector_factories_factory_id ON supaoauth.connector_factories (factory_id);

CREATE TABLE IF NOT EXISTS supaoauth.tenant_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_type VARCHAR(100) NOT NULL,
  key VARCHAR(255) NOT NULL,
  value JSONB DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tenant_configs_type ON supaoauth.tenant_configs (config_type);
CREATE INDEX IF NOT EXISTS idx_tenant_configs_key ON supaoauth.tenant_configs (key);

-- Insert default security config if empty
INSERT INTO supaoauth.security_config (admin_auth_mode, rate_limit_rpm, brute_force_protection, enforce_https)
SELECT 'auto', 300, true, true
WHERE NOT EXISTS (SELECT 1 FROM supaoauth.security_config);

-- Insert default organization template if empty
INSERT INTO supaoauth.organization_templates (name, description, template_roles, template_scopes, is_default)
SELECT 'Default Organization', 'Standard organization with owner/admin/member roles',
  '[{"name":"owner","permissions":["organization.manage","organization.members.manage","organization.settings.manage","resource.read","resource.write"]},{"name":"admin","permissions":["organization.members.manage","resource.read","resource.write"]},{"name":"member","permissions":["resource.read"]}]'::jsonb,
  '[{"name":"organization.manage","description":"Manage organization settings"},{"name":"organization.members.manage","description":"Manage organization members"},{"name":"organization.settings.manage","description":"Manage organization configuration"},{"name":"resource.read","description":"Read organization resources"},{"name":"resource.write","description":"Write organization resources"}]'::jsonb,
  true
WHERE NOT EXISTS (SELECT 1 FROM supaoauth.organization_templates);

-- Seed connector factories and tenant config defaults.
INSERT INTO supaoauth.connector_factories (factory_id, name, protocol, category, config_schema, enabled)
SELECT 'oidc-enterprise', 'Enterprise OIDC', 'oidc', 'enterprise_sso',
  '{"required":["client_id","issuer"],"secret_fields":["client_secret"]}'::jsonb, true
WHERE NOT EXISTS (SELECT 1 FROM supaoauth.connector_factories WHERE factory_id = 'oidc-enterprise');

INSERT INTO supaoauth.connector_factories (factory_id, name, protocol, category, config_schema, enabled)
SELECT 'saml-enterprise', 'Enterprise SAML', 'saml', 'enterprise_sso',
  '{"required":["entity_id","sso_url","certificate"],"secret_fields":["certificate"]}'::jsonb, true
WHERE NOT EXISTS (SELECT 1 FROM supaoauth.connector_factories WHERE factory_id = 'saml-enterprise');

INSERT INTO supaoauth.tenant_configs (config_type, key, value, enabled)
SELECT 'captcha', 'default', '{"provider":"none","configured":false}'::jsonb, false
WHERE NOT EXISTS (SELECT 1 FROM supaoauth.tenant_configs WHERE config_type = 'captcha' AND key = 'default');
`;

// Can be run standalone: bun run src/db/migrate.ts
if (import.meta.main) {
  runMigration().then(() => process.exit(0)).catch(() => process.exit(1));
}
