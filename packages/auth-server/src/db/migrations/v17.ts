// Repair duplicate defaults before enforcing the invariant on existing
// installations. The newest default is retained deterministically.
export const MIGRATION_V17_SQL = `
WITH ranked_defaults AS (
  SELECT id,
    ROW_NUMBER() OVER (ORDER BY updated_at DESC, id DESC) AS rank
  FROM supaoauth.organization_templates
  WHERE is_default = true
)
UPDATE supaoauth.organization_templates AS templates
SET is_default = false,
    updated_at = now()
FROM ranked_defaults
WHERE templates.id = ranked_defaults.id
  AND ranked_defaults.rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_organization_templates_single_default
  ON supaoauth.organization_templates (is_default)
  WHERE is_default = true;
`;
