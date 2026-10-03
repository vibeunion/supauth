export const MIGRATION_V15_SQL = `
UPDATE supaoauth.connectors
SET runtime_kind = 'builtin_oauth'
WHERE provider_id IN ('oidc-enterprise', 'saml-enterprise')
  AND runtime_kind IN ('custom_oidc', 'saml');
`;
