export const MIGRATION_V5_SQL = `
DO $$
BEGIN
  IF to_regclass('supaoauth.provisioning_records') IS NOT NULL THEN
    EXECUTE $legacy_provisioning_dedupe$
DELETE FROM supaoauth.provisioning_records AS p
WHERE EXISTS (
  SELECT 1 FROM supaoauth.provisioning_records AS keep
  WHERE keep.project_ref = p.project_ref
    AND keep.step = p.step
    AND (keep.updated_at, keep.id) > (p.updated_at, p.id)
)
$legacy_provisioning_dedupe$;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_provisioning_records_project_step
      ON supaoauth.provisioning_records (project_ref, step);
  END IF;
END $$;
`;
