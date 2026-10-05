export const MIGRATION_V18_SQL = `
CREATE TABLE IF NOT EXISTS supaoauth.organization_template_instantiations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key VARCHAR(255) NOT NULL,
  template_id UUID NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed', 'recovery_required')),
  organization_id VARCHAR(255),
  result JSONB,
  error_details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_template_instantiations_idempotency_key
  ON supaoauth.organization_template_instantiations (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_org_template_instantiations_template_id
  ON supaoauth.organization_template_instantiations (template_id);
CREATE INDEX IF NOT EXISTS idx_org_template_instantiations_status
  ON supaoauth.organization_template_instantiations (status);
`;
