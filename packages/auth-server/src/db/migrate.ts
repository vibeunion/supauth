// Migration script — creates the `supaoauth` schema and tables on SupaCloud's Postgres

import postgres from 'postgres';

const MIGRATION_SQL = `
-- Create supaoauth schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS supaoauth;

-- API Resources
CREATE TABLE IF NOT EXISTS supaoauth.api_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  indicator VARCHAR(1024) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_resources_indicator ON supaoauth.api_resources (indicator);

-- Scopes
CREATE TABLE IF NOT EXISTS supaoauth.scopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  resource_id UUID NOT NULL REFERENCES supaoauth.api_resources(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scopes_resource_id ON supaoauth.scopes (resource_id);

-- Organizations
CREATE TABLE IF NOT EXISTS supaoauth.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Organization Members
CREATE TABLE IF NOT EXISTS supaoauth.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES supaoauth.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role VARCHAR(100) NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON supaoauth.organization_members (organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON supaoauth.organization_members (user_id);

-- Roles
CREATE TABLE IF NOT EXISTS supaoauth.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Permissions
CREATE TABLE IF NOT EXISTS supaoauth.permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  role_id UUID NOT NULL REFERENCES supaoauth.roles(id) ON DELETE CASCADE,
  scope_id UUID REFERENCES supaoauth.scopes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_permissions_role_id ON supaoauth.permissions (role_id);

-- Sign-in Experience
CREATE TABLE IF NOT EXISTS supaoauth.sign_in_experience (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  logo_url TEXT,
  favicon_url TEXT,
  primary_color VARCHAR(32),
  page_title VARCHAR(255),
  sign_in_methods JSONB DEFAULT '[]'::jsonb,
  sign_up_enabled BOOLEAN NOT NULL DEFAULT true,
  mfa_required BOOLEAN NOT NULL DEFAULT false,
  password_min_length INTEGER NOT NULL DEFAULT 8,
  password_require_uppercase BOOLEAN NOT NULL DEFAULT false,
  password_require_lowercase BOOLEAN NOT NULL DEFAULT false,
  password_require_numbers BOOLEAN NOT NULL DEFAULT false,
  password_require_symbols BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit Logs
CREATE TABLE IF NOT EXISTS supaoauth.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(255) NOT NULL,
  actor_id UUID,
  actor_type VARCHAR(50) NOT NULL DEFAULT 'system',
  resource_type VARCHAR(255) NOT NULL,
  resource_id VARCHAR(255) NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON supaoauth.audit_logs (event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON supaoauth.audit_logs (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON supaoauth.audit_logs (created_at);

-- Webhooks
CREATE TABLE IF NOT EXISTS supaoauth.webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  events JSONB NOT NULL,
  secret TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Connectors (SupaOAuth metadata overlay on GoTrue providers)
CREATE TABLE IF NOT EXISTS supaoauth.connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  config JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connectors_provider_id ON supaoauth.connectors (provider_id);

-- Application-Resource/Scope Bindings
CREATE TABLE IF NOT EXISTS supaoauth.application_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id VARCHAR(255) NOT NULL, -- GoTrue OAuth client_id
  resource_id UUID NOT NULL REFERENCES supaoauth.api_resources(id) ON DELETE CASCADE,
  scope_id UUID REFERENCES supaoauth.scopes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_bindings_app_id ON supaoauth.application_bindings (application_id);
CREATE INDEX IF NOT EXISTS idx_app_bindings_resource_id ON supaoauth.application_bindings (resource_id);

-- Role Assignments (user-level, org-level, M2M app-level)
CREATE TABLE IF NOT EXISTS supaoauth.role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES supaoauth.roles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL, -- references auth.users.id
  organization_id UUID REFERENCES supaoauth.organizations(id) ON DELETE CASCADE, -- null = user-level
  application_id VARCHAR(255), -- null = not app-scoped; GoTrue client_id for M2M
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_role_assignments_role_id ON supaoauth.role_assignments (role_id);
CREATE INDEX IF NOT EXISTS idx_role_assignments_user_id ON supaoauth.role_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_role_assignments_org_id ON supaoauth.role_assignments (organization_id);

-- Supabase-compatible RBAC projection helpers
--
-- These helpers let existing Supabase projects migrate RLS incrementally:
--   USING (auth.uid() = owner_id OR supaoauth.authorize('project.read'))
--
-- The JWT role claim remains authenticated; business RBAC is resolved from
-- supaoauth metadata tables so permission revocation does not wait for token
-- refresh. SECURITY DEFINER is required because authenticated users should not
-- get direct table privileges on supaoauth metadata tables.
CREATE OR REPLACE FUNCTION supaoauth.authorize(permission_name TEXT, target_organization_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = supaoauth, public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM supaoauth.role_assignments ra
    JOIN supaoauth.permissions p ON p.role_id = ra.role_id
    WHERE ra.user_id = auth.uid()
      AND p.name = permission_name
      AND (
        target_organization_id IS NULL
        OR ra.organization_id IS NULL
        OR ra.organization_id = target_organization_id
      )
  );
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

REVOKE ALL ON FUNCTION supaoauth.authorize(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION supaoauth.has_org_permission(UUID, TEXT) FROM PUBLIC;
GRANT USAGE ON SCHEMA supaoauth TO authenticated;
GRANT EXECUTE ON FUNCTION supaoauth.authorize(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION supaoauth.has_org_permission(UUID, TEXT) TO authenticated;

-- Insert default sign-in experience row if empty
INSERT INTO supaoauth.sign_in_experience (page_title, sign_up_enabled, mfa_required)
SELECT 'SupaOAuth', true, false
WHERE NOT EXISTS (SELECT 1 FROM supaoauth.sign_in_experience);
`;

export async function runMigration() {
  const url = process.env.DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL is required for migration');
  const sql = postgres(url, { max: 1 });

  try {
    await sql.unsafe(MIGRATION_SQL);
    console.log('SupaOAuth schema migration completed');
  } catch (e) {
    console.error('Migration failed:', e);
    throw e;
  } finally {
    await sql.end();
  }
}

// Can be run standalone: bun run src/db/migrate.ts
if (import.meta.main) {
  runMigration().then(() => process.exit(0)).catch(() => process.exit(1));
}
