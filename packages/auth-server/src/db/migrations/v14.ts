export const MIGRATION_V14_SQL = `
ALTER TABLE supaoauth.connectors
  ADD COLUMN IF NOT EXISTS runtime_kind VARCHAR(32) NOT NULL DEFAULT 'builtin_oauth';

UPDATE supaoauth.connectors
SET runtime_kind = CASE
  WHEN provider_id = 'oidc-enterprise' THEN 'custom_oidc'
  WHEN provider_id = 'saml-enterprise' THEN 'saml'
  ELSE runtime_kind
END;

ALTER TABLE supaoauth.connectors
  DROP CONSTRAINT IF EXISTS connectors_runtime_kind_check;
ALTER TABLE supaoauth.connectors
  ADD CONSTRAINT connectors_runtime_kind_check
  CHECK (runtime_kind IN ('builtin_oauth', 'custom_oidc', 'saml'));

UPDATE supaoauth.connector_factories
SET config_schema = '{"required":["identifier","name","client_id","client_secret","issuer"],"secret_fields":["client_secret"],"optional":["scopes"]}'::jsonb,
    updated_at = now()
WHERE factory_id = 'oidc-enterprise';

UPDATE supaoauth.connector_factories
SET config_schema = '{"required":["name"],"one_of":[["metadata_url","metadata_xml"]],"optional":["resource_id","domains","metadata_url","metadata_xml","attribute_mapping","name_id_format"]}'::jsonb,
    updated_at = now()
WHERE factory_id = 'saml-enterprise';
`;
