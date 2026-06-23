# Supabase Compatibility Specification

SupaOAuth must remain fully compatible with the Supabase ecosystem. Any feature that breaks the following guarantees is a release blocker.

The enterprise IAM rule is: **SupaOAuth enhances Supabase Auth, it does not replace Supabase Auth**. Enterprise user-center, organization, permission-governance, audit, and approval features live above the Supabase-compatible runtime. They must not change the public GoTrue protocol surface that existing Supabase applications, SDKs, PostgREST, Storage, Realtime, Edge Functions, and RLS policies rely on.

The upstream version rule is: **SupaOAuth must work with the stock upstream GoTrue/Supabase Auth runtime and official Supabase SDKs**. In `runtime_mode=gotrue`, a supported deployment must not require a SupaOAuth-patched GoTrue binary, a forked `@supabase/supabase-js`, a forked Auth UI package, or custom `/auth/v1/*` semantics. SupaOAuth integrations must use documented GoTrue/Supabase extension points, SupaCloud Management API, SupaCloud Functions/Pages, additive metadata under `app_metadata.supaoauth`, and compatibility gates that can be rerun when SupaCloud upgrades the upstream runtime.

## Must-Compatible (Release Blocker)

### SC-1: supabase-js SDK

Business applications must continue using `supabase-js` unmodified:

- `supabase.auth.signInWithOAuth()` triggers GoTrue's existing OAuth flow
- `supabase.auth.getSession()` returns valid GoTrue sessions
- `supabase.auth.getUser()` returns GoTrue user objects
- `supabase.auth.signOut()` invalidates GoTrue sessions
- Token refresh works through GoTrue's existing endpoint

SupaOAuth does not intercept or modify the `supabase-js` auth transport layer.

Application code and hosted UI bridges should keep using official Supabase SDK packages. SupaOAuth may publish adapter packages such as `@supauth/sdk-auth-ui`, but those adapters must configure or wrap official SDKs rather than depending on a fork.

### SC-1a: Upstream GoTrue Version Compatibility

SupaOAuth must tolerate SupaCloud upgrading the underlying GoTrue/Supabase Auth runtime as long as the documented Supabase Auth protocol and extension points remain compatible:

- `/auth/v1/*` remains owned by the upstream GoTrue runtime; SupaOAuth must not shadow it with a private protocol implementation.
- GoTrue discovery, JWKS, token, refresh, MFA, user, and OAuth endpoints are treated as upstream contracts, not SupaOAuth-owned internals.
- SupaOAuth-specific behavior belongs in SupaCloud Functions/Pages, SupaCloud Management API facade calls, Auth Hooks, additive `app_metadata.supaoauth`, or installed compatibility helpers.
- Any missing platform capability should be added to SupaCloud or upstream integration layers, not by requiring a custom GoTrue fork for normal `gotrue` mode.
- Release gates must keep live Supabase Auth compatibility checks runnable against the current deployed upstream version.

### SC-2: auth.users

When `runtime_mode=gotrue`, user identity lives in GoTrue's `auth.users` table:

- SupaOAuth metadata tables reference `auth.users.id` via foreign key
- SupaOAuth does not create a parallel user table
- User CRUD operations are proxied through the SupaCloud adapter to GoTrue
- SupaOAuth may extend user profiles in a separate metadata table keyed by `auth.users.id`

### SC-3: JWT Claims for RLS

Access tokens must preserve all claims required by Supabase Auth's Custom Access Token Hook contract and by common Supabase RLS policies:

| Claim | Source | Usage |
| --- | --- | --- |
| `iss` | GoTrue | Issuer validation |
| `aud` | GoTrue | Token audience validation |
| `exp` | GoTrue | Token expiry |
| `iat` | GoTrue | Token issue time |
| `sub` | GoTrue | User identity in RLS policies |
| `role` | GoTrue | `anon` / `authenticated` / `service_role` runtime role switch |
| `aal` | GoTrue | MFA assurance checks, for example `aal2` RLS gates |
| `session_id` | GoTrue | Session identity and revocation correlation |
| `email` | GoTrue | User identity claim exposed by Supabase Auth |
| `phone` | GoTrue | User identity claim exposed by Supabase Auth |
| `is_anonymous` | GoTrue | Anonymous-user flow compatibility |

SupaOAuth must also preserve common Supabase metadata claims when they are present:

| Claim | Source | Usage |
| --- | --- | --- |
| `app_metadata` | GoTrue | Authorization-safe custom RLS claims and SupaOAuth enterprise projection |
| `user_metadata` | GoTrue | User profile claims; do not use for authorization |

SupaOAuth may add a small namespaced object under `app_metadata.supaoauth`, but must never remove or alter the above required claims or existing metadata claims. Business roles must not replace the top-level `role` claim. Large permission sets should not be copied into every token by default; use a compact role/permission version and resolve full permissions through SupaCloud/SupaOAuth APIs or bounded RLS projections where needed.

OAuth 2.1 access tokens must also preserve `user_id` and `client_id`. Tokens returned by the refresh-token grant are still Supabase JWTs and must pass the same standard-claim, runtime-role, `user_id`/`client_id`, and no-top-level-`supaoauth:*` checks. `user_id` should continue to match `sub`; `client_id` is the OAuth client boundary that RLS or application APIs can use for client-specific access control.

OAuth response `scope` must remain the granted standard scope string. Treat scopes as Supabase OAuth response/UserInfo/ID-token metadata; do not translate enterprise permissions into OAuth scope claims unless a future Supabase-compatible custom-scope mode is explicitly enabled for a project. Database access remains controlled by RLS, usually through `auth.uid()`, `auth.jwt() ->> 'client_id'`, and SupaOAuth versioned permission lookups.

### SC-4: OIDC Discovery and JWKS

In `runtime_mode=gotrue`:
- GoTrue's `/.well-known/openid-configuration` is the authoritative discovery document
- GoTrue's `/.well-known/oauth-authorization-server` is the authoritative OAuth 2.1 authorization-server metadata document
- GoTrue's `/.well-known/jwks.json` is the authoritative key set
- SupaOAuth does not replace or proxy these endpoints with its own signing

In `runtime_mode=external_oidc`:
- SupaOAuth or an external IdP provides OIDC discovery and JWKS
- The issuer must use asymmetric key signing (RS256, ES256, etc.)
- Supabase must be configured for third-party auth trusting the external issuer
- Tokens intended for Supabase APIs should still preserve the Supabase access-token shape and prefer `app_metadata.supaoauth` for enterprise metadata

### SC-5: Supabase API Paths

The following Supabase runtime paths must remain accessible and functional:

| Path Pattern | Service |
| --- | --- |
| `/auth/v1/*` | GoTrue auth |
| `/.well-known/*` | OIDC discovery, JWKS |
| `/rest/v1/*` | PostgREST |
| `/storage/v1/*` | Storage API |
| `/realtime/v1/*` | Realtime WebSocket |
| `/functions/v1/*` | Edge Functions |

SupAuth Function paths must not conflict with these. The Management API facade uses the SupaCloud app route prefix `/api/v1/*`; there is no separate SupAuth service port in the supported runtime.

### SC-6: SupaCloud Project-Scoped Runtime

SupaOAuth must work inside a SupaCloud-created project:

- SupaCloud owns GoTrue, gateway routing, PostgREST, Storage, Realtime, and Functions runtime paths
- SupAuth installs only as SupaCloud Functions and Pages from the generated manifest
- SupAuth Management API is a Function facade over SupaCloud Management API plus SupAuth overlay data
- No standalone SupAuth service, systemd unit, pm2 process, webhook worker, or SupAuth-owned cron is supported

### SC-7: Dual Runtime Mode

**gotrue mode (default)**:
- GoTrue is the token issuer
- JWT is signed with the GoTrue JWT secret
- SupaOAuth is the control plane and BFF only
- All Supabase SDK flows work without modification
- The underlying GoTrue/Supabase Auth service can be a stock upstream version provided by SupaCloud

**external_oidc mode (advanced)**:
- An external IdP (SupaOAuth or third-party) is the token issuer
- Supabase is configured with third-party auth
- Requires OIDC discovery + asymmetric JWKS
- JWT claims must map to what Supabase RLS expects
- Business roles and permission hints should keep the `app_metadata.supaoauth` shape by default
- Must be explicitly enabled per project; not the default

## Optional-Compatible

### SC-8: Row Level Security Extensions

SupaOAuth may enhance RLS by adding a namespaced object under `app_metadata.supaoauth`:

- `roles` — bounded compact SupaOAuth role names or IDs
- `current_org_id` / `organization_ids` — current and accessible organization context
- `scopes` — optional project-specific API-scope hints when explicitly enabled; do not confuse this with the OAuth token response `scope`, and do not use it as the default enterprise database-permission source
- `permissions` — bounded resolved permission set for RLS helper compatibility
- `roles_count` / `permissions_count` plus `rbac_version` / `permissions_version` — cache invalidation and full-lookup markers for APIs that resolve roles or permissions outside the JWT

These claims are additive. They must not replace GoTrue's built-in claims, and they should stay small enough for cookie and proxy header limits.

RLS policies should keep native `auth.uid()` / `auth.jwt()` owner checks and use SupaOAuth helpers only as additive enterprise gates, for example `supaoauth.has_permission(...)` or `supaoauth.has_org_permission(...)`.

### SC-9: Storage and Realtime Auth

- Storage access tokens continue to work through GoTrue's existing JWT
- Realtime WebSocket auth uses the same GoTrue JWT
- SupaOAuth does not issue separate tokens for Storage or Realtime

### SC-10: Edge Functions Auth

- Edge Functions receive the same GoTrue JWT in `Authorization` header
- `supabase-js` Functions client continues to inject the token automatically
- SupaOAuth does not modify the Edge Functions auth chain

## Incompatible (Requires Documentation)

### IC-1: External OIDC Mode Limitations

When using `runtime_mode=external_oidc`:
- GoTrue's built-in `supabase-js` flows may not work directly
- Third-party auth configuration in Supabase is required
- Token claims mapping may differ from GoTrue defaults
- This mode is opt-in and must be documented separately

### IC-2: Custom Claims Namespace

SupaOAuth-added claims use the `app_metadata.supaoauth` namespace:
- They are projected from SupaCloud-managed RBAC or added by a Supabase-compatible auth hook.
- They must be treated as optional by business code until the installed project has enabled the projection.
- RLS policies using `app_metadata.supaoauth` must account for the object being absent.

## Verification Checklist

For each release, verify:

- [ ] `supabase-js` can sign in, get session, refresh token, sign out
- [ ] OAuth 2.1 metadata, authorization-code + PKCE, refresh-token, UserInfo, and unsupported-grant behavior pass `tests/integration/supabase-compat/oauth21.test.ts` against a real runtime
- [ ] `auth.users` is the primary identity table (no parallel user table in gotrue mode)
- [ ] JWT contains all required Supabase Auth claims (`iss`, `aud`, `exp`, `iat`, `sub`, `role`, `aal`, `session_id`, `email`, `phone`, `is_anonymous`)
- [ ] JWT keeps authorization metadata in `app_metadata.supaoauth`, not the top-level `role` claim
- [ ] OIDC discovery document is accessible at `/.well-known/openid-configuration`
- [ ] OAuth authorization-server metadata is accessible at `/.well-known/oauth-authorization-server`
- [ ] JWKS is accessible at `/.well-known/jwks.json`
- [ ] Supabase API paths (`/auth/v1/*`, `/rest/v1/*`, `/storage/v1/*`, `/realtime/v1/*`) remain functional
- [ ] No SupaOAuth-patched GoTrue binary, forked `supabase-js`, forked Auth UI package, or private `/auth/v1/*` behavior is required in `runtime_mode=gotrue`
- [ ] No management tokens or service-role keys appear in browser-visible code or `VITE_*` variables
- [ ] Self-hosted deployment works without Supabase Cloud
- [ ] `runtime_mode=gotrue` works with zero SupaOAuth-specific claims in the JWT
- [ ] `runtime_mode=external_oidc` provides valid OIDC discovery + asymmetric JWKS
- [ ] `runtime_mode=external_oidc` keeps business authorization metadata under `app_metadata.supaoauth` by default
