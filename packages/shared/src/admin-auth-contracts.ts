import { Type, type Static } from './schema.js';

export const AdminPrincipalSchema = Type.Object({
  id: Type.String(), email: Type.String(), name: Type.String(),
  roles: Type.Array(Type.String()), permissions: Type.Array(Type.String()),
  authorization_source: Type.Union([
    Type.Literal('development_token'), Type.Literal('admin_allowlist'), Type.Literal('rbac_projection'),
  ]),
});
export const AdminIdentitySchema = Type.Object({
  ...AdminPrincipalSchema.properties,
  avatar: Type.Union([Type.String(), Type.Null()]),
});
export type AdminIdentity = Static<typeof AdminIdentitySchema>;
export const AdminLoginResponseSchema = Type.Union([
  Type.Object({ success: Type.Literal(true), token: Type.String({ minLength: 1 }) }),
  Type.Object({ success: Type.Literal(false), error: Type.Object({ message: Type.String() }) }),
]);
export const AdminSsoConfigSchema = Type.Object({
  enabled: Type.Boolean(), issuer: Type.String(), client_id: Type.String(),
  redirect_uri: Type.String(), post_logout_redirect_uri: Type.String(), end_session_endpoint: Type.String(),
});
export const AdminOidcDiscoverySchema = Type.Object({
  authorization_endpoint: Type.String(), token_endpoint: Type.String(), userinfo_endpoint: Type.String(),
});
