# Enterprise IAM and Supabase Compatibility Boundary

SupaOAuth's enterprise user-center and permission model must be layered on top of Supabase Auth compatibility, not beside it.

## Compatibility Layer

This layer is a release-blocking contract:

- `/auth/v1/*` always remains stock GoTrue/Supabase Auth; no alternate runtime
  mode is accepted.
- `supabase-js` auth, refresh, session, sign-out, OAuth/OIDC, MFA, PostgREST, Storage, Realtime, Edge Functions, and RLS continue to work without application changes.
- GoTrue remains the owner of `auth.users`, identities, OAuth clients/Grants,
  sessions, refresh tokens, MFA factors, authorization codes, token issuance
  and JWT/JWKS.
- `runtime_mode=gotrue` must run on stock upstream GoTrue/Supabase Auth versions provided by SupaCloud; SupaOAuth must not depend on a patched GoTrue binary, a forked Supabase SDK, or private `/auth/v1/*` behavior.
- SupaOAuth Auth Hooks preserve Supabase required access-token claims: `iss`, `aud`, `exp`, `iat`, `sub`, `role`, `aal`, `session_id`, `email`, `phone`, and `is_anonymous`.
- Enterprise authorization metadata is additive and lives only in the schema-v2 `app_metadata.supaoauth.projects[projectRef]` entry.

## Enterprise Enhancement Layer

This layer can evolve without breaking Supabase clients:

- User center: profile, account claim, TOTP enrollment UI, current-user identities
  and grants, scoped logout, account lifecycle, and audit. Stock GoTrue does not
  expose a session inventory or per-session revoke API.
- Organization model: tenants, departments, groups, project/application membership, and scoped role assignments.
- Permission governance: role templates, permission catalog, effective-permission explanation, high-risk permission review, approval, audit, and periodic recertification.
- Application authorization: OAuth client governance, consent, standard OAuth scopes for UserInfo/ID-token metadata, client-specific permission versions, and business API authorization.
- Compatibility tooling: RLS helper functions, migration assistant, unsafe-policy scanner, and installed-project verification.

Enhancements should use documented GoTrue/Supabase extension points, SupaCloud Management API, SupaCloud Functions/Pages, Auth Hooks, and additive schema-v2 metadata at `app_metadata.supaoauth.projects[projectRef]`. If a feature needs a new runtime primitive, the durable path is a SupaCloud/upstream integration change plus compatibility gates, not a product-local fork of GoTrue.

## Data Placement Rules

| Data | Default location | Rule |
| --- | --- | --- |
| User identity | `auth.users` | Never create a parallel identity source in `runtime_mode=gotrue`. |
| Supabase-required token claims | GoTrue access token | Preserve all required claims through custom access-token hooks. |
| OAuth Grant | GoTrue `auth.oauth_grants` | Sole authorization fact source; SupaOAuth consent rows are policy/decision audit only. |
| Identity, Grants, Session, Refresh Token, MFA | GoTrue | Only documented GoTrue actions are exposed: current-user Grants, separately opt-in manual identity linking/unlinking, scoped logout, user-token TOTP, and supported admin MFA reset. No runtime state is copied and no unsupported admin facade is invented. |
| Enterprise RBAC source | SupaCloud Management API | SupaOAuth Admin Console is a governance facade, not a duplicate RBAC database. |
| RLS projection | `app_metadata.supaoauth.projects[projectRef]` plus `supaoauth` helper functions | Schema v2 project isolation; do not overwrite top-level `role`. |
| Overlay configuration | `supaoauth` schema / tenant config | Hosted UI, phrases, account-claim records, sign-in experience, and product-only settings. |
| Full permission resolution | SupaCloud/SupaOAuth API or bounded projection | Avoid unbounded permission arrays in JWTs. Use `rbac_version` / `permissions_version` for cache invalidation. |
| Auth runtime version | SupaCloud-managed upstream GoTrue/Supabase Auth | Track with live compatibility gates; do not pin normal `gotrue` mode to a SupaOAuth-specific fork. |

Generic user-profile updates may pass through Supabase-compatible fields such as `email`, `phone`, `user_metadata`, and non-RBAC `app_metadata`, but they must not write `role`, `app_metadata.role`, the schema-v2 namespace root `app_metadata.supaoauth`, or any `app_metadata.supaoauth.projects[projectRef]` entry. RBAC and claim projection changes go only through SupaCloud RBAC APIs. The hidden `/v1/sync/*` compatibility routes return `capability_unavailable`, so profile and provisioning operations cannot clobber enterprise authorization metadata.

## Authorization Strategy

Use RBAC for coarse product access and add business-aware checks where RBAC is insufficient:

- RBAC: user/group/role grants permission strings like `users.read` or `reports.export`.
- Organization scope: role assignments can be tenant, department, project, application, or organization scoped.
- Ownership and ABAC: APIs still enforce rules such as "creator can edit draft", "reviewer cannot approve own submission", or "department users can only read department data".
- RLS: keep `auth.uid()` owner policies, then add `supaoauth.has_permission(...)`, `supaoauth.authorize(...)`, or `supaoauth.has_org_permission(...)` where a table needs enterprise permissions.

UI gating is only a convenience. API handlers, Edge Functions, and RLS policies remain the authorization boundary.

## Token Strategy

In GoTrue mode, access tokens keep Supabase semantics:

- `role` stays `authenticated`, `anon`, or `service_role`.
- `aal` and `session_id` stay available for MFA/session-sensitive policies.
- Bounded role IDs, organization context, application projections, and role/permission versions live only at `app_metadata.supaoauth.projects[projectRef]`; its namespace root has schema version `2`.
- The root permits only `schema_version`, `projects`, and valid `hook`; v1 root fields are removed and never used as an authorization fallback.
- If the role projection is truncated, full role display and governance must use the Management API instead of assuming the JWT contains every role.
- If RLS needs direct permission checks, the projection can include a bounded `permissions` array; when `permissions_truncated=true`, RLS helpers fail closed and broad enterprise APIs must use versioned lookup instead of copying large permission sets into JWTs.

## MFA and OAuth Rules

- TOTP enrollment, challenge, verification, and unenrollment use GoTrue/Supabase Auth user-token APIs. SupaOAuth may provide BFF/UI orchestration but must not store TOTP secrets.
- User self-service MFA must use GoTrue user-token enroll/challenge/verify/unenroll flows. Admin reset is a governance operation in the Admin Console, not a user self-service substitute for GoTrue factor unenrollment.
- OAuth 2.1 and OIDC tokens remain standard Supabase JWTs in GoTrue mode. Enterprise client authorization should use `client_id`, consent, standard OAuth scopes for UserInfo/ID-token metadata, and permission versions rather than a custom token format or scope-as-database-permission model.
- An alternate issuer, independent discovery/JWKS, independent Session/MFA or
  signing-key runtime is unsupported. A non-`gotrue` runtime value fails startup
  and installation instead of entering a degraded dual-mode state.

Capabilities that require a parallel credential or issuer are outside the
product boundary: RFC 8693 Token Exchange, Subject Token, generic one-time
Bearer Token, Personal Access Token, outbound SAML IdP, MFA backup codes,
unverified Passkey ceremony and arbitrary Inline Hooks. They do not enter the
menu, SDK, OpenAPI or migrations. Any temporary compatibility route is hidden
and returns `capability_unavailable`.

## Verification Gates

Before claiming enterprise IAM compatibility:

- Run the static contract tests for Auth Hooks, SupaCloud app routes, RBAC migrations, and artifact verification.
- Run live Supabase compatibility checks when runtime credentials are available: `supabase-js`, OAuth 2.1 metadata/PKCE, UserInfo, refresh token, and RLS smoke.
- Verify the deployed runtime still works as stock upstream GoTrue/Supabase Auth, without patched `/auth/v1/*` semantics or forked official SDK packages.
- Verify install-time RBAC migration checks against the project database, including helper existence, grants, and unsafe top-level JWT `role` policies.
- Verify Admin Console user details can explain effective permissions and role source without mutating Supabase runtime claims.
