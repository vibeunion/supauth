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

REVOKE ALL ON FUNCTION supaoauth.current_project_ref() FROM PUBLIC;
