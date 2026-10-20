export const MIGRATION_V10_SQL = `
DO $$
DECLARE
  webhook_count BIGINT := 0;
  delivery_count BIGINT := 0;
BEGIN
  IF to_regclass('supaoauth.webhooks') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM supaoauth.webhooks' INTO webhook_count;
  END IF;
  IF to_regclass('supaoauth.webhook_deliveries') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM supaoauth.webhook_deliveries' INTO delivery_count;
  END IF;

  IF webhook_count > 0 OR delivery_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'legacy_webhook_retirement_blocked',
      DETAIL = format(
        'reason_code=legacy_webhook_data_present; webhook_rows=%s; delivery_rows=%s',
        webhook_count,
        delivery_count
      ),
      HINT = 'Back up the legacy tables, recreate and rotate every webhook in SupaCloud Secret Manager, then clear the retired rows and rerun this migration.';
  END IF;
END $$;

DROP TABLE IF EXISTS supaoauth.webhook_deliveries;
DROP TABLE IF EXISTS supaoauth.webhooks;
`;
