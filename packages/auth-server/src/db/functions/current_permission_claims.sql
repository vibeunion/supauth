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

REVOKE ALL ON FUNCTION supaoauth.current_permission_claims(UUID) FROM PUBLIC;
