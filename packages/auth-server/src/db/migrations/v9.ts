export const MIGRATION_V9_SQL = `
-- SupaCloud owns webhook definitions, secrets, outbox state, and deliveries.
-- This migration commits independently so a later retirement block cannot
-- restore Function access to legacy secrets or queued payloads.
DO $$
DECLARE
  project_role TEXT := 'role_' || regexp_replace(current_database(), '^supa_', '');
BEGIN
  IF to_regclass('supaoauth.webhook_deliveries') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE supaoauth.webhook_deliveries FROM PUBLIC';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = project_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE supaoauth.webhook_deliveries FROM %I', project_role);
    END IF;
  END IF;

  IF to_regclass('supaoauth.webhooks') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE supaoauth.webhooks FROM PUBLIC';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = project_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE supaoauth.webhooks FROM %I', project_role);
    END IF;
  END IF;
END $$;
`;
