// Claims mapping types — SupaOAuth to Supabase-compatible JWT

export const SUPAOAUTH_CLAIMS_NAMESPACE = 'supaoauth';

export const SUPAOAUTH_APP_METADATA_KEY = 'supaoauth';

export const SUPAOAUTH_APP_METADATA_SCHEMA_VERSION = 2 as const;

export const SUPABASE_RUNTIME_ROLES = ['anon', 'authenticated', 'service_role'] as const;

export type SupabaseRuntimeRole = typeof SUPABASE_RUNTIME_ROLES[number];

// JWT claims that Supabase RLS depends on (must never be removed/altered)
export const SUPABASE_REQUIRED_CLAIMS = [
  'iss',
  'aud',
  'exp',
  'iat',
  'sub',
  'role',
  'aal',
  'session_id',
  'email',
  'phone',
  'is_anonymous',
] as const;

export type SupabaseRequiredClaim = typeof SUPABASE_REQUIRED_CLAIMS[number];

// Standard metadata claims are optional in Supabase's hook contract, but
// SupaOAuth preserves them because enterprise metadata lives under
// app_metadata.supaoauth and user profile data must remain GoTrue-compatible.
export const SUPABASE_METADATA_CLAIMS = [
  'app_metadata',
  'user_metadata',
] as const;

export type SupabaseMetadataClaim = typeof SUPABASE_METADATA_CLAIMS[number];

export const SUPABASE_OAUTH_ACCESS_TOKEN_CLAIMS = [
  'client_id',
  'scope',
] as const;

export type SupabaseOAuthAccessTokenClaim = typeof SUPABASE_OAUTH_ACCESS_TOKEN_CLAIMS[number];

export const SUPABASE_OAUTH_STANDARD_SCOPES = [
  'openid',
  'email',
  'profile',
  'phone',
] as const;

export type SupabaseOAuthStandardScope = typeof SUPABASE_OAUTH_STANDARD_SCOPES[number];

// These removed top-level names are exported so trust boundaries can reject
// them explicitly. Schema v2 never reads or emits them.
export const SUPAOAUTH_CLAIM_KEYS = [
  'supaoauth:roles',
  'supaoauth:org_id',
  'supaoauth:org_role',
  'supaoauth:scopes',
  'supaoauth:permissions',
] as const;

// One shared bound keeps GoTrue projection, previews, and SDK-visible metadata aligned.
export const SUPAOAUTH_ROLE_PROJECTION_LIMIT = 64;

export const SUPAOAUTH_PERMISSION_PROJECTION_LIMIT = 256;

export const SUPAOAUTH_PROJECT_PROJECTION_BYTE_LIMIT = 16 * 1024;

export const SUPAOAUTH_NAMESPACE_PROJECTION_BYTE_LIMIT = 64 * 1024;

export const SUPAOAUTH_ORGANIZATION_MEMBERSHIP_LIMIT = 50;

export const SUPAOAUTH_ORGANIZATION_MEMBERSHIP_FIELD_LENGTH_LIMIT = 128;

export interface SupaOAuthJWTClaims {
  // Standard Supabase claims
  sub: string;
  role: SupabaseRuntimeRole;
  aud: string;
  iss: string;
  exp: number;
  iat: number;
  aal: string;
  session_id: string;
  email?: string;
  phone?: string;
  is_anonymous: boolean;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;

  // Supabase OAuth server access-token claims (stock GoTrue v2.192+)
  client_id?: string;
  scope?: string;

  /** @deprecated Stock GoTrue uses the standard `sub` claim for the user ID. */
  user_id?: string;
}

export interface SupaOAuthOrganizationMembershipProjection {
  organization_id: string;
  slug: string;
  role: string;
}

export interface SupaOAuthPermissionSetProjection {
  roles?: string[];
  roles_count?: number;
  roles_truncated?: boolean;
  roles_projection_limit?: number;
  permissions?: string[];
  permissions_count?: number;
  permissions_truncated?: boolean;
  permissions_projection_limit?: number;
  scopes?: string[];
}

export interface SupaOAuthApplicationProjection extends SupaOAuthPermissionSetProjection {
  organization_ids?: string[];
  organizations?: Record<string, SupaOAuthPermissionSetProjection>;
}

export interface SupaOAuthProjectProjection extends SupaOAuthPermissionSetProjection {
  application_id?: string;
  rbac_version?: number;
  permissions_version?: number;
  organization_ids?: string[];
  organizations?: Record<string, SupaOAuthPermissionSetProjection>;
  applications?: Record<string, SupaOAuthApplicationProjection>;
  organization_memberships?: SupaOAuthOrganizationMembershipProjection[];
  organization_memberships_total?: number;
  organization_memberships_truncated?: boolean;
  current_org_id?: string;
  current_org_role?: string;
  rbac_synced_at?: string;
  scopes_count?: number;
  organization_ids_count?: number;
  organizations_count?: number;
  applications_count?: number;
  truncated?: boolean;
  projection_limit?: number;
  projection_unavailable?: boolean;
}

export interface SupaOAuthHookMetadata {
  version: 1;
  authentication_method: string;
  processed_at: string;
}

export interface SupaOAuthAppMetadata {
  schema_version: typeof SUPAOAUTH_APP_METADATA_SCHEMA_VERSION;
  projects: Record<string, SupaOAuthProjectProjection>;
  hook?: SupaOAuthHookMetadata;
}

// Mapping strategy: how SupaOAuth concepts map to JWT claims in each mode
export interface ClaimsMappingStrategy {
  mode: 'gotrue';
  roles: {
    location: 'app_metadata' | 'jwt_claim';
    key: string;
  };
  organization: {
    location: 'app_metadata' | 'jwt_claim';
    key: string;
  };
  scopes: {
    location: 'app_metadata' | 'management_api' | 'jwt_claim';
    key: string;
  };
  permissions: {
    location: 'app_metadata' | 'management_api' | 'jwt_claim';
    key: string;
  };
  applications: {
    location: 'app_metadata' | 'management_api';
    key: string;
  };
}

export const GOTRUE_CLAIMS_STRATEGY: ClaimsMappingStrategy = {
  mode: 'gotrue',
  roles: { location: 'app_metadata', key: 'app_metadata.supaoauth.projects.{projectRef}.roles' },
  organization: { location: 'app_metadata', key: 'app_metadata.supaoauth.projects.{projectRef}.current_org_id' },
  scopes: { location: 'app_metadata', key: 'app_metadata.supaoauth.projects.{projectRef}.scopes' },
  permissions: { location: 'app_metadata', key: 'app_metadata.supaoauth.projects.{projectRef}.permissions' },
  applications: { location: 'app_metadata', key: 'app_metadata.supaoauth.projects.{projectRef}.applications' },
};
