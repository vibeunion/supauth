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

REVOKE ALL ON FUNCTION supaoauth.current_project_claims() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supaoauth.current_project_claims() TO authenticated;
