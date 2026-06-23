# Enterprise IAM and Supabase Compatibility Boundary

SupaOAuth's enterprise user-center and permission model must be layered on top of Supabase Auth compatibility, not beside it.

## Compatibility Layer

This layer is a release-blocking contract:

- `/auth/v1/*` remains GoTrue/Supabase Auth unless a project explicitly opts into documented external OIDC mode.
- `supabase-js` auth, refresh, session, sign-out, OAuth/OIDC, MFA, PostgREST, Storage, Realtime, Edge Functions, and RLS continue to work without application changes.
- GoTrue remains the owner of `auth.users`, sessions, identities, refresh tokens, MFA factors, OAuth authorization codes, and token issuance in `runtime_mode=gotrue`.
- `runtime_mode=gotrue` must run on stock upstream GoTrue/Supabase Auth versions provided by SupaCloud; SupaOAuth must not depend on a patched GoTrue binary, a forked Supabase SDK, or private `/auth/v1/*` behavior.
- SupaOAuth Auth Hooks preserve Supabase required access-token claims: `iss`, `aud`, `exp`, `iat`, `sub`, `role`, `aal`, `session_id`, `email`, `phone`, and `is_anonymous`.
- Enterprise authorization metadata is additive and namespaced under `app_metadata.supaoauth`.

## Enterprise Enhancement Layer

This layer can evolve without breaking Supabase clients:

- User center: profile, account claim, MFA enrollment UI, sessions, identities, grants, account lifecycle, and audit.
- Organization model: tenants, departments, groups, project/application membership, and scoped role assignments.
- Permission governance: role templates, permission catalog, effective-permission explanation, high-risk permission review, approval, audit, and periodic recertification.
- Application authorization: OAuth client governance, consent, standard OAuth scopes for UserInfo/ID-token metadata, client-specific permission versions, and business API authorization.
- Compatibility tooling: RLS helper functions, migration assistant, unsafe-policy scanner, and installed-project verification.

Enhancements should use documented GoTrue/Supabase extension points, SupaCloud Management API, SupaCloud Functions/Pages, Auth Hooks, and additive metadata. If a feature needs a new runtime primitive, the durable path is a SupaCloud/upstream integration change plus compatibility gates, not a product-local fork of GoTrue.

## Data Placement Rules

| Data | Default location | Rule |
| --- | --- | --- |
| User identity | `auth.users` | Never create a parallel identity source in `runtime_mode=gotrue`. |
| Supabase-required token claims | GoTrue access token | Preserve all required claims through custom access-token hooks. |
| Enterprise RBAC source | SupaCloud Management API | SupaOAuth Admin Console is a governance facade, not a duplicate RBAC database. |
| RLS projection | `app_metadata.supaoauth` plus `supaoauth` helper functions | Additive compatibility bridge; do not overwrite top-level `role`. |
| Overlay configuration | `supaoauth` schema / tenant config | Hosted UI, phrases, account-claim records, sign-in experience, and product-only settings. |
| Full permission resolution | SupaCloud/SupaOAuth API or bounded projection | Avoid unbounded permission arrays in JWTs. Use `rbac_version` / `permissions_version` for cache invalidation. |
| Auth runtime version | SupaCloud-managed upstream GoTrue/Supabase Auth | Track with live compatibility gates; do not pin normal `gotrue` mode to a SupaOAuth-specific fork. |

Generic user-profile updates may pass through Supabase-compatible fields such as `email`, `phone`, `user_metadata`, and non-RBAC `app_metadata`, but they must not write `role`, `app_metadata.role`, or `app_metadata.supaoauth`. SupaOAuth RBAC and claim projection changes must go through SupaCloud RBAC APIs, account-provisioning sync, or `/v1/sync/*`, so safe profile edits cannot clobber enterprise authorization metadata.

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
- `app_metadata.supaoauth` may include bounded compact role IDs, organization context, and role/permission version markers.
- If the role projection is truncated, full role display and governance must use the Management API instead of assuming the JWT contains every role.
- If RLS needs direct permission checks, the projection can include a bounded `permissions` array; when `permissions_truncated=true`, RLS helpers fail closed and broad enterprise APIs must use versioned lookup instead of copying large permission sets into JWTs.

## MFA and OAuth Rules

- TOTP enrollment, challenge, verification, and unenrollment use GoTrue/Supabase Auth user-token APIs. SupaOAuth may provide BFF/UI orchestration but must not store TOTP secrets.
- User self-service MFA must use GoTrue user-token enroll/challenge/verify/unenroll flows. Admin reset is a governance operation in the Admin Console, not a user self-service substitute for GoTrue factor unenrollment.
- OAuth 2.1 and OIDC tokens remain standard Supabase JWTs in GoTrue mode. Enterprise client authorization should use `client_id`, consent, standard OAuth scopes for UserInfo/ID-token metadata, and permission versions rather than a custom token format or scope-as-database-permission model.
- External OIDC mode is advanced and opt-in. It must document every Supabase compatibility limitation before use.

## Verification Gates

Before claiming enterprise IAM compatibility:

- Run the static contract tests for Auth Hooks, SupaCloud app routes, RBAC migrations, and artifact verification.
- Run live Supabase compatibility checks when runtime credentials are available: `supabase-js`, OAuth 2.1 metadata/PKCE, UserInfo, refresh token, and RLS smoke.
- Verify the deployed runtime still works as stock upstream GoTrue/Supabase Auth, without patched `/auth/v1/*` semantics or forked official SDK packages.
- Verify install-time RBAC migration checks against the project database, including helper existence, grants, and unsafe top-level JWT `role` policies.
- Verify Admin Console user details can explain effective permissions and role source without mutating Supabase runtime claims.
