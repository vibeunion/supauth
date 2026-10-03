export const MIGRATION_V11_SQL = `
-- Select the permission set from the trusted OAuth application and optional
-- organization context. Unknown applications and truncated projections fail closed;
-- an absent organization projection keeps root permissions inherited by that scope.
CREATE OR REPLACE FUNCTION supaoauth.current_permission_claims(target_organization_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = supaoauth, public, auth
AS $$
  WITH project_context AS (
    SELECT
      supaoauth.current_project_claims() AS project_claims,
      NULLIF(auth.jwt() ->> 'client_id', '') AS token_application_id
  ), application_context AS (
    SELECT
      project_claims,
      COALESCE(token_application_id, NULLIF(project_claims ->> 'application_id', '')) AS trusted_application_id
    FROM project_context
  ), scoped AS (
    SELECT
      project_claims,
      CASE
        WHEN trusted_application_id IS NULL THEN project_claims
        WHEN project_claims ->> 'application_id' = trusted_application_id THEN project_claims
        WHEN jsonb_typeof(project_claims -> 'applications' -> trusted_application_id) = 'object'
          THEN project_claims -> 'applications' -> trusted_application_id
        ELSE '{}'::jsonb
      END AS permission_claims
    FROM application_context
  ), organization_scoped AS (
    SELECT
      project_claims,
      permission_claims AS application_claims,
      CASE
        WHEN target_organization_id IS NULL THEN permission_claims
        WHEN jsonb_typeof(permission_claims -> 'organizations' -> target_organization_id::text) = 'object'
          THEN permission_claims -> 'organizations' -> target_organization_id::text
        ELSE permission_claims
      END AS permission_claims
    FROM scoped
  )
  SELECT CASE
    WHEN COALESCE(project_claims -> 'projection_unavailable', 'false'::jsonb) = 'true'::jsonb
      OR COALESCE(project_claims -> 'truncated', 'false'::jsonb) = 'true'::jsonb
      OR COALESCE(application_claims -> 'projection_unavailable', 'false'::jsonb) = 'true'::jsonb
      OR COALESCE(application_claims -> 'truncated', 'false'::jsonb) = 'true'::jsonb
      OR COALESCE(application_claims -> 'permissions_truncated', 'false'::jsonb) = 'true'::jsonb
      OR COALESCE(permission_claims -> 'projection_unavailable', 'false'::jsonb) = 'true'::jsonb
      OR COALESCE(permission_claims -> 'truncated', 'false'::jsonb) = 'true'::jsonb
      OR COALESCE(permission_claims -> 'permissions_truncated', 'false'::jsonb) = 'true'::jsonb
    THEN '{}'::jsonb
    ELSE permission_claims
  END
  FROM organization_scoped;
$$;

CREATE OR REPLACE FUNCTION supaoauth.authorize(permission_name TEXT, target_organization_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = supaoauth, public, auth
AS $$
  SELECT COALESCE(
    (supaoauth.current_permission_claims(target_organization_id) -> 'permissions') ? permission_name,
    false
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

REVOKE ALL ON FUNCTION supaoauth.current_permission_claims(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION supaoauth.authorize(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION supaoauth.has_permission(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION supaoauth.has_org_permission(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION supaoauth.app_has_org_permission(TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supaoauth.authorize(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION supaoauth.has_permission(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION supaoauth.has_org_permission(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION supaoauth.app_has_org_permission(TEXT, UUID, TEXT) TO authenticated;
`;
