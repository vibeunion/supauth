export const MIGRATION_V6_SQL = `
-- GoTrue owns active OAuth grants. This table stores only the user's decision
-- and correlation identifiers needed for product audit and reconciliation.
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

-- Duplicate configuration represents ambiguous runtime state. The migration
-- fails instead of choosing a winner and silently discarding user settings.
CREATE UNIQUE INDEX IF NOT EXISTS uq_api_resources_indicator
  ON supaoauth.api_resources (indicator);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scopes_resource_name
  ON supaoauth.scopes (resource_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_connectors_provider_id
  ON supaoauth.connectors (provider_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_factories_factory_id
  ON supaoauth.connector_factories (factory_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_application_bindings_target
  ON supaoauth.application_bindings (
    application_id,
    resource_id,
    COALESCE(scope_id, '00000000-0000-0000-0000-000000000000')
  );
CREATE UNIQUE INDEX IF NOT EXISTS uq_application_consent_settings_app_id
  ON supaoauth.application_consent_settings (application_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_configs_type_key
  ON supaoauth.tenant_configs (config_type, key);
`;
