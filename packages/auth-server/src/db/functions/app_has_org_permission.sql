CREATE OR REPLACE FUNCTION supaoauth.app_has_org_permission(client_id TEXT, organization_id UUID, permission_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = supaoauth, public, auth
AS $$
  WITH context AS (
    SELECT
      supaoauth.current_project_claims() AS project_claims,
      NULLIF(auth.jwt() ->> 'client_id', '') AS token_application_id
  )
  SELECT
    COALESCE(
      COALESCE(token_application_id, NULLIF(project_claims ->> 'application_id', '')) = client_id,
      false
    )
    AND supaoauth.authorize(permission_name, organization_id)
  FROM context;
$$;

REVOKE ALL ON FUNCTION supaoauth.app_has_org_permission(TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supaoauth.app_has_org_permission(TEXT, UUID, TEXT) TO authenticated;
