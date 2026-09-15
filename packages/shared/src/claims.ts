// Claims mapping types — SupaOAuth to Supabase-compatible JWT
import { JsonObjectSchema, StringKeySchema, Type, type Static } from './schema.js';

export const SUPAOAUTH_CLAIMS_NAMESPACE = 'supaoauth';

export const SUPAOAUTH_APP_METADATA_KEY = 'supaoauth';

export const SUPAOAUTH_APP_METADATA_SCHEMA_VERSION = 2 as const;

export const SUPABASE_RUNTIME_ROLES = ['anon', 'authenticated', 'service_role'] as const;

export const SupabaseRuntimeRoleSchema = Type.Union(SUPABASE_RUNTIME_ROLES.map((value) => Type.Literal(value)));
export type SupabaseRuntimeRole = Static<typeof SupabaseRuntimeRoleSchema>;

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

export const SupabaseRequiredClaimSchema = Type.Union(SUPABASE_REQUIRED_CLAIMS.map((value) => Type.Literal(value)));
export type SupabaseRequiredClaim = Static<typeof SupabaseRequiredClaimSchema>;

// Standard metadata claims are optional in Supabase's hook contract, but
// SupaOAuth preserves them because enterprise metadata lives under
// app_metadata.supaoauth and user profile data must remain GoTrue-compatible.
export const SUPABASE_METADATA_CLAIMS = [
  'app_metadata',
  'user_metadata',
] as const;

export const SupabaseMetadataClaimSchema = Type.Union(SUPABASE_METADATA_CLAIMS.map((value) => Type.Literal(value)));
export type SupabaseMetadataClaim = Static<typeof SupabaseMetadataClaimSchema>;

export const SUPABASE_OAUTH_ACCESS_TOKEN_CLAIMS = [
  'client_id',
  'scope',
] as const;

export const SupabaseOAuthAccessTokenClaimSchema = Type.Union(SUPABASE_OAUTH_ACCESS_TOKEN_CLAIMS.map((value) => Type.Literal(value)));
export type SupabaseOAuthAccessTokenClaim = Static<typeof SupabaseOAuthAccessTokenClaimSchema>;

export const SUPABASE_OAUTH_STANDARD_SCOPES = [
  'openid',
  'email',
  'profile',
  'phone',
  'offline_access',
] as const;

export const SupabaseOAuthStandardScopeSchema = Type.Union(SUPABASE_OAUTH_STANDARD_SCOPES.map((value) => Type.Literal(value)));
export type SupabaseOAuthStandardScope = Static<typeof SupabaseOAuthStandardScopeSchema>;

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

// 仅描述载荷形状；签名、有效期和发行方校验仍由认证边界负责。
export const SupaOAuthJWTClaimsSchema = Type.Object({
  // Standard Supabase claims
  sub: Type.String(),
  role: SupabaseRuntimeRoleSchema,
  aud: Type.String(),
  iss: Type.String(),
  exp: Type.Number(),
  iat: Type.Number(),
  aal: Type.String(),
  session_id: Type.String(),
  email: Type.Optional(Type.String()),
  phone: Type.Optional(Type.String()),
  is_anonymous: Type.Boolean(),
  app_metadata: Type.Optional(JsonObjectSchema),
  user_metadata: Type.Optional(JsonObjectSchema),

  // Supabase OAuth server access-token claims (stock GoTrue v2.192+)
  client_id: Type.Optional(Type.String()),
  scope: Type.Optional(Type.String()),

  // Accepted authorized-party metadata for identity adapters; not required issuance.
  azp: Type.Optional(Type.String()),

  /** @deprecated Stock GoTrue uses the standard `sub` claim for the user ID. */
  user_id: Type.Optional(Type.String()),
});
export type SupaOAuthJWTClaims = Static<typeof SupaOAuthJWTClaimsSchema>;

export const SupaOAuthOrganizationMembershipProjectionSchema = Type.Object({
  organization_id: Type.String(),
  slug: Type.String(),
  role: Type.String(),
});
export type SupaOAuthOrganizationMembershipProjection = Static<typeof SupaOAuthOrganizationMembershipProjectionSchema>;

export const SupaOAuthPermissionSetProjectionSchema = Type.Object({
  roles: Type.Optional(Type.Array(Type.String())),
  roles_count: Type.Optional(Type.Number()),
  roles_truncated: Type.Optional(Type.Boolean()),
  roles_projection_limit: Type.Optional(Type.Number()),
  permissions: Type.Optional(Type.Array(Type.String())),
  permissions_count: Type.Optional(Type.Number()),
  permissions_truncated: Type.Optional(Type.Boolean()),
  permissions_projection_limit: Type.Optional(Type.Number()),
  scopes: Type.Optional(Type.Array(Type.String())),
});
export type SupaOAuthPermissionSetProjection = Static<typeof SupaOAuthPermissionSetProjectionSchema>;

export const SupaOAuthApplicationProjectionSchema = Type.Composite([
  SupaOAuthPermissionSetProjectionSchema,
  Type.Object({
    organization_ids: Type.Optional(Type.Array(Type.String())),
    organizations: Type.Optional(Type.Record(StringKeySchema, SupaOAuthPermissionSetProjectionSchema)),
  }),
]);
export type SupaOAuthApplicationProjection = Static<typeof SupaOAuthApplicationProjectionSchema>;

export const SupaOAuthProjectProjectionSchema = Type.Composite([
  SupaOAuthPermissionSetProjectionSchema,
  Type.Object({
    application_id: Type.Optional(Type.String()),
    rbac_version: Type.Optional(Type.Number()),
    permissions_version: Type.Optional(Type.Number()),
    organization_ids: Type.Optional(Type.Array(Type.String())),
    organizations: Type.Optional(Type.Record(StringKeySchema, SupaOAuthPermissionSetProjectionSchema)),
    applications: Type.Optional(Type.Record(StringKeySchema, SupaOAuthApplicationProjectionSchema)),
    organization_memberships: Type.Optional(Type.Array(SupaOAuthOrganizationMembershipProjectionSchema)),
    organization_memberships_total: Type.Optional(Type.Number()),
    organization_memberships_truncated: Type.Optional(Type.Boolean()),
    current_org_id: Type.Optional(Type.String()),
    current_org_role: Type.Optional(Type.String()),
    rbac_synced_at: Type.Optional(Type.String()),
    scopes_count: Type.Optional(Type.Number()),
    organization_ids_count: Type.Optional(Type.Number()),
    organizations_count: Type.Optional(Type.Number()),
    applications_count: Type.Optional(Type.Number()),
    truncated: Type.Optional(Type.Boolean()),
    projection_limit: Type.Optional(Type.Number()),
    projection_unavailable: Type.Optional(Type.Boolean()),
  }),
]);
export type SupaOAuthProjectProjection = Static<typeof SupaOAuthProjectProjectionSchema>;

export const SupaOAuthHookMetadataSchema = Type.Object({
  version: Type.Literal(1),
  authentication_method: Type.String(),
  processed_at: Type.String(),
});
export type SupaOAuthHookMetadata = Static<typeof SupaOAuthHookMetadataSchema>;

export const SupaOAuthAppMetadataSchema = Type.Object({
  schema_version: Type.Literal(SUPAOAUTH_APP_METADATA_SCHEMA_VERSION),
  projects: Type.Record(StringKeySchema, SupaOAuthProjectProjectionSchema),
  hook: Type.Optional(SupaOAuthHookMetadataSchema),
});
export type SupaOAuthAppMetadata = Static<typeof SupaOAuthAppMetadataSchema>;

// Mapping strategy: how SupaOAuth concepts map to JWT claims in each mode
export const ClaimsMappingStrategySchema = Type.Object({
  mode: Type.Literal('gotrue'),
  roles: Type.Object({
    location: Type.Union([Type.Literal('app_metadata'), Type.Literal('jwt_claim')]),
    key: Type.String(),
  }),
  organization: Type.Object({
    location: Type.Union([Type.Literal('app_metadata'), Type.Literal('jwt_claim')]),
    key: Type.String(),
  }),
  scopes: Type.Object({
    location: Type.Union([Type.Literal('app_metadata'), Type.Literal('management_api'), Type.Literal('jwt_claim')]),
    key: Type.String(),
  }),
  permissions: Type.Object({
    location: Type.Union([Type.Literal('app_metadata'), Type.Literal('management_api'), Type.Literal('jwt_claim')]),
    key: Type.String(),
  }),
  applications: Type.Object({
    location: Type.Union([Type.Literal('app_metadata'), Type.Literal('management_api')]),
    key: Type.String(),
  }),
});
export type ClaimsMappingStrategy = Static<typeof ClaimsMappingStrategySchema>;

export const GOTRUE_CLAIMS_STRATEGY: ClaimsMappingStrategy = {
  mode: 'gotrue',
  roles: { location: 'app_metadata', key: 'app_metadata.supaoauth.projects.{projectRef}.roles' },
  organization: { location: 'app_metadata', key: 'app_metadata.supaoauth.projects.{projectRef}.current_org_id' },
  scopes: { location: 'app_metadata', key: 'app_metadata.supaoauth.projects.{projectRef}.scopes' },
  permissions: { location: 'app_metadata', key: 'app_metadata.supaoauth.projects.{projectRef}.permissions' },
  applications: { location: 'app_metadata', key: 'app_metadata.supaoauth.projects.{projectRef}.applications' },
};
