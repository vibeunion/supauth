// Migration script for SupAuth overlay tables in a SupaCloud project.
// SupaCloud owns identity management tables; this migration intentionally does
// not create duplicate Organizations/RBAC/Users/Audit/Webhooks source tables.

import postgres from 'postgres';

export const MIGRATION_SQL = `
CREATE SCHEMA IF NOT EXISTS supaoauth;

-- API resource overlay used by SupAuth product UX and RLS migration helpers.
CREATE TABLE IF NOT EXISTS supaoauth.api_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  indicator VARCHAR(1024) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_resources_indicator ON supaoauth.api_resources (indicator);

CREATE TABLE IF NOT EXISTS supaoauth.scopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  resource_id UUID NOT NULL REFERENCES supaoauth.api_resources(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scopes_resource_id ON supaoauth.scopes (resource_id);

-- Hosted sign-in experience overlays. SupaCloud/GoTrue still own runtime auth.
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

CREATE TABLE IF NOT EXISTS supaoauth.application_sign_in_experience (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id VARCHAR(255) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  logo_url TEXT,
  favicon_url TEXT,
  primary_color VARCHAR(32),
  page_title VARCHAR(255),
  background_url TEXT,
  button_label VARCHAR(255),
  custom_css TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_sie_app_id ON supaoauth.application_sign_in_experience (application_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_sie_app_id ON supaoauth.application_sign_in_experience (application_id);

-- Connector visibility/display overlay on top of SupaCloud providers.
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

-- Application/resource binding overlay. Applications themselves live in SupaCloud.
CREATE TABLE IF NOT EXISTS supaoauth.application_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id VARCHAR(255) NOT NULL,
  resource_id UUID NOT NULL REFERENCES supaoauth.api_resources(id) ON DELETE CASCADE,
  scope_id UUID REFERENCES supaoauth.scopes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_bindings_app_id ON supaoauth.application_bindings (application_id);
CREATE INDEX IF NOT EXISTS idx_app_bindings_resource_id ON supaoauth.application_bindings (resource_id);

-- OAuth consent overlays. Organization IDs are SupaCloud IDs, not local FKs.
CREATE TABLE IF NOT EXISTS supaoauth.user_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  application_id VARCHAR(255) NOT NULL,
  scope_id UUID REFERENCES supaoauth.scopes(id) ON DELETE CASCADE,
  organization_id UUID,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_user_consents_user_id ON supaoauth.user_consents (user_id);
CREATE INDEX IF NOT EXISTS idx_user_consents_app_id ON supaoauth.user_consents (application_id);
CREATE INDEX IF NOT EXISTS idx_user_consents_org_id ON supaoauth.user_consents (organization_id);

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

-- Template overlay; instantiation calls SupaCloud Organizations/RBAC APIs.
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

-- Product/security/tenant UX overlays.
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

-- Account provisioning overlay. User creation itself goes through SupaCloud.
CREATE TABLE IF NOT EXISTS supaoauth.account_provisioning_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id VARCHAR(100) NOT NULL,
  external_type VARCHAR(100) NOT NULL DEFAULT 'generic',
  display_name VARCHAR(255) NOT NULL,
  normalized_display_name VARCHAR(255) NOT NULL,
  email VARCHAR(320) NOT NULL,
  user_id UUID,
  initial_password_encrypted TEXT,
  initial_password_claimed BOOLEAN NOT NULL DEFAULT false,
  claimed_at TIMESTAMPTZ,
  claim_count INTEGER NOT NULL DEFAULT 0,
  source_status VARCHAR(50) NOT NULL DEFAULT 'active',
  profile JSONB DEFAULT '{}'::jsonb,
  import_batch VARCHAR(255),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_provisioning_external ON supaoauth.account_provisioning_records (external_type, external_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_provisioning_email ON supaoauth.account_provisioning_records (email);
CREATE INDEX IF NOT EXISTS idx_account_provisioning_normalized_name ON supaoauth.account_provisioning_records (normalized_display_name);
CREATE INDEX IF NOT EXISTS idx_account_provisioning_user_id ON supaoauth.account_provisioning_records (user_id);

-- Supabase-compatible RBAC projection helpers.
--
-- SupaCloud owns RBAC. SupAuth sync projects effective permissions into
-- auth.users.app_metadata.supaoauth.permissions. RLS helpers read the JWT copy
-- so new projects do not need duplicated local RBAC tables.
CREATE OR REPLACE FUNCTION supaoauth.authorize(permission_name TEXT, target_organization_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = supaoauth, public, auth
AS $$
  WITH claims AS (
    SELECT COALESCE(auth.jwt() -> 'app_metadata' -> 'supaoauth', '{}'::jsonb) AS supaoauth_claims
  )
  SELECT
    COALESCE((supaoauth_claims -> 'permissions') ? permission_name, false)
    AND (
      target_organization_id IS NULL
      OR supaoauth_claims ->> 'current_org_id' = target_organization_id::text
      OR COALESCE((supaoauth_claims -> 'organization_ids') ? target_organization_id::text, false)
    )
  FROM claims;
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
  WITH claims AS (
    SELECT COALESCE(auth.jwt() -> 'app_metadata' -> 'supaoauth', '{}'::jsonb) AS supaoauth_claims
  )
  SELECT
    COALESCE((supaoauth_claims -> 'permissions') ? permission_name, false)
    AND (
      supaoauth_claims ->> 'application_id' = client_id
      OR auth.jwt() ->> 'client_id' = client_id
    )
    AND (
      organization_id IS NULL
      OR supaoauth_claims ->> 'current_org_id' = organization_id::text
      OR COALESCE((supaoauth_claims -> 'organization_ids') ? organization_id::text, false)
    )
  FROM claims;
$$;

REVOKE ALL ON FUNCTION supaoauth.authorize(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION supaoauth.has_org_permission(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION supaoauth.app_has_org_permission(TEXT, UUID, TEXT) FROM PUBLIC;
GRANT USAGE ON SCHEMA supaoauth TO authenticated;
GRANT EXECUTE ON FUNCTION supaoauth.authorize(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION supaoauth.has_org_permission(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION supaoauth.app_has_org_permission(TEXT, UUID, TEXT) TO authenticated;

-- Defaults for overlay tables.
INSERT INTO supaoauth.sign_in_experience (page_title, sign_up_enabled, mfa_required)
SELECT 'SupaOAuth', true, false
WHERE NOT EXISTS (SELECT 1 FROM supaoauth.sign_in_experience);

INSERT INTO supaoauth.security_config (admin_auth_mode, rate_limit_rpm, brute_force_protection, enforce_https)
SELECT 'auto', 300, true, true
WHERE NOT EXISTS (SELECT 1 FROM supaoauth.security_config);

INSERT INTO supaoauth.organization_templates (name, description, template_roles, template_scopes, is_default)
SELECT 'Default Organization', 'Standard organization with owner/admin/member roles',
  '[{"name":"owner","permissions":["organization.manage","organization.members.manage","organization.settings.manage","resource.read","resource.write"]},{"name":"admin","permissions":["organization.members.manage","resource.read","resource.write"]},{"name":"member","permissions":["resource.read"]}]'::jsonb,
  '[{"name":"organization.manage","description":"Manage organization settings"},{"name":"organization.members.manage","description":"Manage organization members"},{"name":"organization.settings.manage","description":"Manage organization configuration"},{"name":"resource.read","description":"Read organization resources"},{"name":"resource.write","description":"Write organization resources"}]'::jsonb,
  true
WHERE NOT EXISTS (SELECT 1 FROM supaoauth.organization_templates);

INSERT INTO supaoauth.connector_factories (factory_id, name, protocol, category, config_schema, enabled)
SELECT 'oidc-enterprise', 'Enterprise OIDC', 'oidc', 'enterprise_sso',
  '{"required":["client_id","issuer"],"secret_fields":["client_secret"]}'::jsonb, true
WHERE NOT EXISTS (SELECT 1 FROM supaoauth.connector_factories WHERE factory_id = 'oidc-enterprise');

INSERT INTO supaoauth.connector_factories (factory_id, name, protocol, category, config_schema, enabled)
SELECT 'saml-enterprise', 'Enterprise SAML', 'saml', 'enterprise_sso',
  '{"required":["entity_id","sso_url","certificate"],"secret_fields":["certificate"]}'::jsonb, true
WHERE NOT EXISTS (SELECT 1 FROM supaoauth.connector_factories WHERE factory_id = 'saml-enterprise');

-- Enterprise social SSO connectors (reserved — no runtime adapter yet)
INSERT INTO supaoauth.connector_factories (factory_id, name, protocol, category, config_schema, enabled)
SELECT 'wecom-work', '企业微信', 'oauth2', 'enterprise_sso',
  '{"required":["corp_id","agent_id"],"secret_fields":["secret"],"optional":["callback_url"],"notes":"Reserved for future WeCom Work OAuth2 adapter"}'::jsonb, false
WHERE NOT EXISTS (SELECT 1 FROM supaoauth.connector_factories WHERE factory_id = 'wecom-work');

INSERT INTO supaoauth.connector_factories (factory_id, name, protocol, category, config_schema, enabled)
SELECT 'feishu', '飞书', 'oauth2', 'enterprise_sso',
  '{"required":["app_id"],"secret_fields":["app_secret"],"optional":["callback_url"],"notes":"Reserved for future Feishu/Lark OAuth2 adapter"}'::jsonb, false
WHERE NOT EXISTS (SELECT 1 FROM supaoauth.connector_factories WHERE factory_id = 'feishu');

INSERT INTO supaoauth.connector_factories (factory_id, name, protocol, category, config_schema, enabled)
SELECT 'dingtalk', '钉钉', 'oauth2', 'enterprise_sso',
  '{"required":["app_key"],"secret_fields":["app_secret"],"optional":["callback_url"],"notes":"Reserved for future DingTalk OAuth2 adapter"}'::jsonb, false
WHERE NOT EXISTS (SELECT 1 FROM supaoauth.connector_factories WHERE factory_id = 'dingtalk');

INSERT INTO supaoauth.tenant_configs (config_type, key, value, enabled)
SELECT 'captcha', 'default', '{"provider":"none","configured":false}'::jsonb, false
WHERE NOT EXISTS (SELECT 1 FROM supaoauth.tenant_configs WHERE config_type = 'captcha' AND key = 'default');
`;

export const PROJECT_ROLE_GRANTS_SQL = `
DO $$
DECLARE
  project_role TEXT := 'role_' || regexp_replace(current_database(), '^supa_', '');
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = project_role) THEN
    EXECUTE format('GRANT USAGE ON SCHEMA supaoauth TO %I', project_role);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA supaoauth TO %I', project_role);
    EXECUTE format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA supaoauth TO %I', project_role);
    EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA supaoauth TO %I', project_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA supaoauth GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', project_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA supaoauth GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I', project_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA supaoauth GRANT EXECUTE ON FUNCTIONS TO %I', project_role);
    EXECUTE format('GRANT USAGE ON SCHEMA auth TO %I', project_role);
    EXECUTE format('GRANT SELECT, UPDATE ON TABLE auth.oauth_authorizations TO %I', project_role);
  END IF;
END $$;
`;

export const MIGRATION_V4_SQL = `
-- Active consent uniqueness. This overlay table is still owned by SupAuth.
UPDATE supaoauth.user_consents AS c
SET revoked_at = COALESCE(c.revoked_at, now())
WHERE c.revoked_at IS NULL
  AND EXISTS (
    SELECT 1 FROM supaoauth.user_consents AS keep
    WHERE keep.revoked_at IS NULL
      AND keep.user_id = c.user_id
      AND keep.application_id = c.application_id
      AND COALESCE(keep.scope_id, '00000000-0000-0000-0000-000000000000')
        = COALESCE(c.scope_id, '00000000-0000-0000-0000-000000000000')
      AND COALESCE(keep.organization_id, '00000000-0000-0000-0000-000000000000')
        = COALESCE(c.organization_id, '00000000-0000-0000-0000-000000000000')
      AND (keep.granted_at, keep.id) > (c.granted_at, c.id)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_consents_active
  ON supaoauth.user_consents (user_id, application_id, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'), COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'))
  WHERE revoked_at IS NULL;

-- Legacy webhook/application-secret tables are no longer created on new
-- SupaCloud-native installs. If they already exist, keep their hardening DDL.
DO $$
BEGIN
  IF to_regclass('supaoauth.webhooks') IS NOT NULL THEN
    EXECUTE $legacy_webhook_deliveries$
CREATE TABLE IF NOT EXISTS supaoauth.webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES supaoauth.webhooks(id) ON DELETE CASCADE,
  event_type VARCHAR(255) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_response_code INTEGER,
  last_error TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
$legacy_webhook_deliveries$;
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending ON supaoauth.webhook_deliveries (next_attempt_at) WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id ON supaoauth.webhook_deliveries (webhook_id);
  END IF;

  IF to_regclass('supaoauth.application_secrets') IS NOT NULL THEN
    ALTER TABLE supaoauth.application_secrets ADD COLUMN IF NOT EXISTS secret_hash TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_application_secrets_active
      ON supaoauth.application_secrets (application_id, secret_id)
      WHERE status = 'active';
  END IF;
END $$;
`;

export const MIGRATION_V5_SQL = `
DO $$
BEGIN
  IF to_regclass('supaoauth.provisioning_records') IS NOT NULL THEN
    EXECUTE $legacy_provisioning_dedupe$
DELETE FROM supaoauth.provisioning_records AS p
WHERE EXISTS (
  SELECT 1 FROM supaoauth.provisioning_records AS keep
  WHERE keep.project_ref = p.project_ref
    AND keep.step = p.step
    AND (keep.updated_at, keep.id) > (p.updated_at, p.id)
)
$legacy_provisioning_dedupe$;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_provisioning_records_project_step
      ON supaoauth.provisioning_records (project_ref, step);
  END IF;
END $$;
`;

export async function runMigration(databaseUrl?: string) {
  const url = databaseUrl || process.env.SUPACLOUD_DATABASE_URL || process.env.DATABASE_URL || '';
  if (!url) throw new Error('SUPACLOUD_DATABASE_URL or DATABASE_URL is required for migration');
  const sql = postgres(url, { max: 1 });

  try {
    await sql.unsafe(MIGRATION_SQL);
    await sql.unsafe(MIGRATION_V4_SQL);
    await sql.unsafe(MIGRATION_V5_SQL);
    await sql.unsafe(PROJECT_ROLE_GRANTS_SQL);
    console.log('SupaOAuth overlay schema migration completed');
  } catch (e) {
    console.error(`Migration failed: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  console.error('Direct DB migration is removed. Run `bun run install:supacloud` so SupaCloud Management API applies hosted migrations.');
  process.exit(1);
}
