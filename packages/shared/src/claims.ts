// Claims mapping types — SupaOAuth to Supabase-compatible JWT

export const SUPAOAUTH_CLAIMS_NAMESPACE = 'supaoauth';

export const SUPAOAUTH_APP_METADATA_KEY = 'supaoauth';

// JWT claims that Supabase RLS depends on (must never be removed/altered)
export const SUPABASE_REQUIRED_CLAIMS = [
  'sub',
  'role',
  'aud',
  'iss',
  'exp',
  'app_metadata',
  'user_metadata',
] as const;

export type SupabaseRequiredClaim = typeof SUPABASE_REQUIRED_CLAIMS[number];

// SupaOAuth namespaced claims (only present in external_oidc mode)
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
  role: 'anon' | 'authenticated';
  aud: string;
  iss: string;
  exp: number;
  iat?: number;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;

  // SupaOAuth namespaced claims (external_oidc mode only)
  'supaoauth:roles'?: string[];
  'supaoauth:org_id'?: string;
  'supaoauth:org_role'?: string;
  'supaoauth:scopes'?: string[];
  'supaoauth:permissions'?: string[];
}

export interface SupaOAuthAppMetadata {
  rbac_version?: number;
  roles?: string[];
  org_ids?: string[];
  current_org_id?: string;
  current_org_role?: string;
}

// Mapping strategy: how SupaOAuth concepts map to JWT claims in each mode
export interface ClaimsMappingStrategy {
  mode: 'gotrue' | 'external_oidc';
  roles: {
    location: 'app_metadata' | 'jwt_claim';
    key: string; // e.g. 'supaoauth_roles' or 'supaoauth:roles'
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
  roles: { location: 'app_metadata', key: 'supaoauth.roles' },
  organization: { location: 'app_metadata', key: 'supaoauth.current_org_id' },
  scopes: { location: 'management_api', key: '' },
  permissions: { location: 'management_api', key: '' },
};

export const EXTERNAL_OIDC_CLAIMS_STRATEGY: ClaimsMappingStrategy = {
  mode: 'external_oidc',
  roles: { location: 'jwt_claim', key: 'supaoauth:roles' },
  organization: { location: 'jwt_claim', key: 'supaoauth:org_id' },
  scopes: { location: 'jwt_claim', key: 'supaoauth:scopes' },
  permissions: { location: 'jwt_claim', key: 'supaoauth:permissions' },
};
