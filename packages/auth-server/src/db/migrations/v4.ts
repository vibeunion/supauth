export const MIGRATION_V4_SQL = `
-- Existing installations retain historical consent rows for read-only audit.
DO $$
BEGIN
  IF to_regclass('supaoauth.user_consents') IS NOT NULL THEN
    EXECUTE $legacy_consent_dedupe$
UPDATE supaoauth.user_consents AS c
SET revoked_at = COALESCE(c.revoked_at, now())
WHERE c.revoked_at IS NULL
  AND EXISTS (
    SELECT 1 FROM supaoauth.user_consents AS keep
    WHERE keep.revoked_at IS NULL
      AND keep.user_id = c.user_id
      AND keep.application_id = c.application_id
      AND COALESCE(keep.scope_id, '00000000-0000-0000-0000-000000000000')
        = COALESCE(c.scope_id, '00000000-0000-0000-0000-000000000000')
      AND COALESCE(keep.organization_id, '00000000-0000-0000-0000-000000000000')
        = COALESCE(c.organization_id, '00000000-0000-0000-0000-000000000000')
      AND (keep.granted_at, keep.id) > (c.granted_at, c.id)
  )
$legacy_consent_dedupe$;
    EXECUTE $legacy_consent_index$
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_consents_active
  ON supaoauth.user_consents (user_id, application_id, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'), COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'))
  WHERE revoked_at IS NULL
$legacy_consent_index$;
  END IF;
END $$;

-- Legacy application-secret tables are no longer created on new installs.
DO $$
BEGIN
  IF to_regclass('supaoauth.application_secrets') IS NOT NULL THEN
    ALTER TABLE supaoauth.application_secrets ADD COLUMN IF NOT EXISTS secret_hash TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_application_secrets_active
      ON supaoauth.application_secrets (application_id, secret_id)
      WHERE status = 'active';
  END IF;
END $$;
`;
