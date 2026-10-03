export const MIGRATION_V8_SQL = `
-- RBAC projections are project-scoped even when several projects share one
-- GoTrue authority. Legacy root-level projections intentionally fail closed.
CREATE OR REPLACE FUNCTION supaoauth.current_project_ref()
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = supaoauth, public, auth
AS $$
  SELECT CASE
    WHEN current_database() ~ '^supa_.+$' THEN substring(current_database() FROM 6)
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION supaoauth.current_project_claims()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = supaoauth, public, auth
AS $$
  WITH projection AS (
    SELECT
      COALESCE(auth.jwt() -> 'app_metadata' -> 'supaoauth', '{}'::jsonb) AS namespace,
      supaoauth.current_project_ref() AS project_ref
  )
  SELECT CASE
    WHEN namespace ->> 'schema_version' = '2'
      AND project_ref IS NOT NULL
      AND jsonb_typeof(namespace -> 'projects' -> project_ref) = 'object'
      AND COALESCE(namespace -> 'projects' -> project_ref -> 'projection_unavailable', 'false'::jsonb) <> 'true'::jsonb
    THEN namespace -> 'projects' -> project_ref
    ELSE '{}'::jsonb
  END
  FROM projection;
$$;

CREATE OR REPLACE FUNCTION supaoauth.authorize(permission_name TEXT, target_organization_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = supaoauth, public, auth
AS $$
  WITH claims AS (
    SELECT supaoauth.current_project_claims() AS project_claims
  )
  SELECT
    COALESCE((project_claims -> 'permissions') ? permission_name, false)
    AND COALESCE(project_claims -> 'permissions_truncated', 'false'::jsonb) <> 'true'::jsonb
    AND (
      target_organization_id IS NULL
      OR project_claims ->> 'current_org_id' = target_organization_id::text
      OR COALESCE((project_claims -> 'organization_ids') ? target_organization_id::text, false)
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
    SELECT supaoauth.current_project_claims() AS project_claims
  )
  SELECT
    COALESCE((project_claims -> 'permissions') ? permission_name, false)
    AND COALESCE(project_claims -> 'permissions_truncated', 'false'::jsonb) <> 'true'::jsonb
    AND (
      project_claims ->> 'application_id' = client_id
      OR auth.jwt() ->> 'client_id' = client_id
    )
    AND (
      organization_id IS NULL
      OR project_claims ->> 'current_org_id' = organization_id::text
      OR COALESCE((project_claims -> 'organization_ids') ? organization_id::text, false)
    )
  FROM claims;
$$;

REVOKE ALL ON FUNCTION supaoauth.current_project_ref() FROM PUBLIC;
REVOKE ALL ON FUNCTION supaoauth.current_project_claims() FROM PUBLIC;
REVOKE ALL ON FUNCTION supaoauth.authorize(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION supaoauth.has_permission(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION supaoauth.has_org_permission(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION supaoauth.app_has_org_permission(TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supaoauth.current_project_claims() TO authenticated;
GRANT EXECUTE ON FUNCTION supaoauth.authorize(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION supaoauth.has_permission(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION supaoauth.has_org_permission(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION supaoauth.app_has_org_permission(TEXT, UUID, TEXT) TO authenticated;
`;
