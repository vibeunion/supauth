export const MIGRATION_V13_SQL = `
-- current_permission_claims reads only the caller's signed JWT projection. Direct
-- execution enables reviewable one-time RLS scope sets without exposing server data.
REVOKE ALL ON FUNCTION supaoauth.current_permission_claims(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION supaoauth.current_permission_claims(UUID) TO authenticated;
ALTER FUNCTION supaoauth.current_permission_claims(UUID) SET search_path = '';
`;
