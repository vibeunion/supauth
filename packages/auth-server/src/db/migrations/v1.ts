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
CREATE UNIQUE INDEX IF NOT EXISTS uq_api_resources_indicator ON supaoauth.api_resources (indicator);

CREATE TABLE IF NOT EXISTS supaoauth.scopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  resource_id UUID NOT NULL REFERENCES supaoauth.api_resources(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scopes_resource_id ON supaoauth.scopes (resource_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scopes_resource_name ON supaoauth.scopes (resource_id, name);

-- Hosted sign-in experience overlays. SupaCloud/GoTrue still own runtime auth.
CREATE TABLE IF NOT EXISTS supaoauth.sign_in_experience (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  logo_url TEXT,
  favicon_url TEXT,
  primary_color VARCHAR(32),
  page_title VARCHAR(255),
  description TEXT,
  background_url TEXT,
  button_label VARCHAR(255),
  custom_css TEXT,
  content JSONB,
  sign_in_methods JSONB DEFAULT '[]'::jsonb,
  sign_up_enabled BOOLEAN NOT NULL DEFAULT true,
  password_min_length INTEGER NOT NULL DEFAULT 8,
  password_require_uppercase BOOLEAN NOT NULL DEFAULT false,
  password_require_lowercase BOOLEAN NOT NULL DEFAULT false,
  password_require_numbers BOOLEAN NOT NULL DEFAULT false,
  password_require_symbols BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Login page theme fields (config-driven tenant default).
ALTER TABLE supaoauth.sign_in_experience ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE supaoauth.sign_in_experience ADD COLUMN IF NOT EXISTS background_url TEXT;
ALTER TABLE supaoauth.sign_in_experience ADD COLUMN IF NOT EXISTS button_label VARCHAR(255);
ALTER TABLE supaoauth.sign_in_experience ADD COLUMN IF NOT EXISTS custom_css TEXT;
DO $$
DECLARE
  current_type TEXT;
BEGIN
  SELECT data_type INTO current_type
  FROM information_schema.columns
  WHERE table_schema = 'supaoauth'
    AND table_name = 'sign_in_experience'
    AND column_name = 'content';

  IF current_type IS NULL THEN
    ALTER TABLE supaoauth.sign_in_experience ADD COLUMN content JSONB;
  ELSIF current_type <> 'jsonb' THEN
    ALTER TABLE supaoauth.sign_in_experience RENAME COLUMN content TO content_legacy;
    ALTER TABLE supaoauth.sign_in_experience ADD COLUMN content JSONB;
    DROP FUNCTION IF EXISTS supaoauth.try_parse_jsonb(TEXT);
    CREATE FUNCTION supaoauth.try_parse_jsonb(input TEXT) RETURNS JSONB
    LANGUAGE plpgsql IMMUTABLE AS $fn$
    BEGIN
      RETURN input::jsonb;
    EXCEPTION WHEN others THEN
      RETURN NULL;
    END;
    $fn$;
    UPDATE supaoauth.sign_in_experience
    SET content = supaoauth.try_parse_jsonb(content_legacy)
    WHERE content_legacy IS NOT NULL;
    ALTER TABLE supaoauth.sign_in_experience DROP COLUMN content_legacy;
    DROP FUNCTION supaoauth.try_parse_jsonb(TEXT);
  END IF;
END $$;

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
  content JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$
DECLARE
  current_type TEXT;
BEGIN
  SELECT data_type INTO current_type
  FROM information_schema.columns
  WHERE table_schema = 'supaoauth'
    AND table_name = 'application_sign_in_experience'
    AND column_name = 'content';

  IF current_type IS NULL THEN
    ALTER TABLE supaoauth.application_sign_in_experience ADD COLUMN content JSONB;
  ELSIF current_type <> 'jsonb' THEN
    ALTER TABLE supaoauth.application_sign_in_experience RENAME COLUMN content TO content_legacy;
    ALTER TABLE supaoauth.application_sign_in_experience ADD COLUMN content JSONB;
    DROP FUNCTION IF EXISTS supaoauth.try_parse_jsonb(TEXT);
    CREATE FUNCTION supaoauth.try_parse_jsonb(input TEXT) RETURNS JSONB
    LANGUAGE plpgsql IMMUTABLE AS $fn$
    BEGIN
      RETURN input::jsonb;
    EXCEPTION WHEN others THEN
      RETURN NULL;
    END;
    $fn$;
    UPDATE supaoauth.application_sign_in_experience
    SET content = supaoauth.try_parse_jsonb(content_legacy)
    WHERE content_legacy IS NOT NULL;
    ALTER TABLE supaoauth.application_sign_in_experience DROP COLUMN content_legacy;
    DROP FUNCTION supaoauth.try_parse_jsonb(TEXT);
  END IF;
END $$;
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
CREATE UNIQUE INDEX IF NOT EXISTS uq_connectors_provider_id ON supaoauth.connectors (provider_id);

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
CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_factories_factory_id ON supaoauth.connector_factories (factory_id);

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
CREATE UNIQUE INDEX IF NOT EXISTS uq_application_bindings_target
  ON supaoauth.application_bindings (
    application_id,
    resource_id,
    COALESCE(scope_id, '00000000-0000-0000-0000-000000000000')
  );

-- Consent policy is local, but grants remain authoritative in GoTrue.
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
CREATE UNIQUE INDEX IF NOT EXISTS uq_application_consent_settings_app_id ON supaoauth.application_consent_settings (application_id);

CREATE TABLE IF NOT EXISTS supaoauth.oauth_consent_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_id VARCHAR(255),
  user_id UUID NOT NULL,
  application_id VARCHAR(255) NOT NULL,
  requested_scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  organization_id VARCHAR(255),
  decision VARCHAR(16) NOT NULL CHECK (decision IN ('approved', 'denied')),
  grant_id VARCHAR(255),
  request_id VARCHAR(255),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_consent_decisions_authorization_id
  ON supaoauth.oauth_consent_decisions (authorization_id);
CREATE INDEX IF NOT EXISTS idx_oauth_consent_decisions_user_id
  ON supaoauth.oauth_consent_decisions (user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_consent_decisions_app_id
  ON supaoauth.oauth_consent_decisions (application_id);

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
CREATE TABLE IF NOT EXISTS supaoauth.organization_template_instantiations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key VARCHAR(255) NOT NULL,
  template_id UUID NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed', 'recovery_required')),
  organization_id VARCHAR(255),
  result JSONB,
  error_details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_template_instantiations_idempotency_key
  ON supaoauth.organization_template_instantiations (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_org_template_instantiations_template_id
  ON supaoauth.organization_template_instantiations (template_id);
CREATE INDEX IF NOT EXISTS idx_org_template_instantiations_status
  ON supaoauth.organization_template_instantiations (status);

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
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_configs_type_key ON supaoauth.tenant_configs (config_type, key);

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
-- Historical helper definitions retained for ordered installs. Migration V8
-- replaces them with schema-v2 project-scoped readers before installation ends.
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
    AND COALESCE(supaoauth_claims -> 'permissions_truncated', 'false'::jsonb) <> 'true'::jsonb
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

CREATE OR REPLACE FUNCTION supaoauth.has_permission(permission_name TEXT, target_organization_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = supaoauth, public, auth
AS $$
  SELECT supaoauth.authorize(permission_name, target_organization_id);
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
    AND COALESCE(supaoauth_claims -> 'permissions_truncated', 'false'::jsonb) <> 'true'::jsonb
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
REVOKE ALL ON FUNCTION supaoauth.has_permission(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION supaoauth.has_org_permission(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION supaoauth.app_has_org_permission(TEXT, UUID, TEXT) FROM PUBLIC;
GRANT USAGE ON SCHEMA supaoauth TO authenticated;
GRANT EXECUTE ON FUNCTION supaoauth.authorize(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION supaoauth.has_permission(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION supaoauth.has_org_permission(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION supaoauth.app_has_org_permission(TEXT, UUID, TEXT) TO authenticated;

-- Defaults for overlay tables.
INSERT INTO supaoauth.sign_in_experience (page_title, sign_up_enabled)
SELECT 'SupaOAuth', true
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
