export const MIGRATION_V12_SQL = `
ALTER TABLE supaoauth.account_provisioning_records
  ADD COLUMN IF NOT EXISTS claim_proof_hash TEXT,
  ADD COLUMN IF NOT EXISTS claim_state VARCHAR(32) NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS claim_mode VARCHAR(32),
  ADD COLUMN IF NOT EXISTS claim_password_hash TEXT,
  ADD COLUMN IF NOT EXISTS claim_operation_id UUID,
  ADD COLUMN IF NOT EXISTS claim_lease_expires_at TIMESTAMPTZ;

UPDATE supaoauth.account_provisioning_records
SET claim_state = CASE
  WHEN initial_password_claimed THEN 'claimed'
  ELSE claim_state
END;

ALTER TABLE supaoauth.account_provisioning_records
  DROP CONSTRAINT IF EXISTS account_provisioning_claim_state_check;

ALTER TABLE supaoauth.account_provisioning_records
  ADD CONSTRAINT account_provisioning_claim_state_check
  CHECK (claim_state IN ('ready', 'pending', 'password_applied', 'password_update_unknown', 'claimed'));
`;
