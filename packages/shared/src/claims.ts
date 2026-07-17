// Claims mapping types — SupaOAuth to Supabase-compatible JWT

export const SUPAOAUTH_CLAIMS_NAMESPACE = 'supaoauth';

export const SUPAOAUTH_APP_METADATA_KEY = 'supaoauth';

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

// Legacy/advanced namespaced claims. The default external_oidc strategy still
// prefers app_metadata.supaoauth so Supabase RLS policies keep the same shape.
export const SUPAOAUTH_CLAIM_KEYS = [
  'supaoauth:roles',
  'supaoauth:org_id',
  'supaoauth:org_role',
  'supaoauth:scopes',
  'supaoauth:permissions',
] as const;

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

  // Supabase OAuth server access-token claims (stock GoTrue v2.191+)
  client_id?: string;
  scope?: string;

  /** @deprecated Stock GoTrue uses the standard `sub` claim for the user ID. */
  user_id?: string;

  // SupaOAuth namespaced claims (legacy explicit external_oidc projection only)
  'supaoauth:roles'?: string[];
  'supaoauth:org_id'?: string;
  'supaoauth:org_role'?: string;
  'supaoauth:scopes'?: string[];
  'supaoauth:permissions'?: string[];
}

export interface SupaOAuthAppMetadata {
  rbac_version?: number;
  permissions_version?: number;
  roles?: string[];
  roles_count?: number;
  roles_truncated?: boolean;
  roles_projection_limit?: number;
  permissions?: string[];
  permissions_count?: number;
  permissions_truncated?: boolean;
  permissions_projection_limit?: number;
  org_ids?: string[];
  current_org_id?: string;
  current_org_role?: string;
}

// Mapping strategy: how SupaOAuth concepts map to JWT claims in each mode
export interface ClaimsMappingStrategy {
  mode: 'gotrue' | 'external_oidc';
  roles: {
    location: 'app_metadata' | 'jwt_claim';
    key: string; // e.g. 'app_metadata.supaoauth.roles' or 'supaoauth:roles'
  };
  organization: {
    location: 'app_metadata' | 'jwt_claim';
    key: string;
  };
  scopes: {
    location: 'management_api' | 'jwt_claim';
    key: string;
  };
  permissions: {
    location: 'management_api' | 'jwt_claim';
    key: string;
  };
}

export const GOTRUE_CLAIMS_STRATEGY: ClaimsMappingStrategy = {
  mode: 'gotrue',
  roles: { location: 'app_metadata', key: 'app_metadata.supaoauth.roles' },
  organization: { location: 'app_metadata', key: 'app_metadata.supaoauth.current_org_id' },
  scopes: { location: 'management_api', key: '' },
  permissions: { location: 'management_api', key: '' },
};

export const EXTERNAL_OIDC_CLAIMS_STRATEGY: ClaimsMappingStrategy = {
  mode: 'external_oidc',
  roles: { location: 'app_metadata', key: 'app_metadata.supaoauth.roles' },
  organization: { location: 'app_metadata', key: 'app_metadata.supaoauth.current_org_id' },
  scopes: { location: 'management_api', key: '' },
  permissions: { location: 'management_api', key: '' },
};

export const LEGACY_EXTERNAL_OIDC_TOP_LEVEL_CLAIMS_STRATEGY: ClaimsMappingStrategy = {
  mode: 'external_oidc',
  roles: { location: 'jwt_claim', key: 'supaoauth:roles' },
  organization: { location: 'jwt_claim', key: 'supaoauth:org_id' },
  scopes: { location: 'jwt_claim', key: 'supaoauth:scopes' },
  permissions: { location: 'jwt_claim', key: 'supaoauth:permissions' },
};
