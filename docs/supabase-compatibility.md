# Supabase Compatibility Specification

SupaOAuth must remain fully compatible with the Supabase ecosystem. Any feature that breaks the following guarantees is a release blocker.

## Must-Compatible (Release Blocker)

### SC-1: supabase-js SDK

Business applications must continue using `supabase-js` unmodified:

- `supabase.auth.signInWithOAuth()` triggers GoTrue's existing OAuth flow
- `supabase.auth.getSession()` returns valid GoTrue sessions
- `supabase.auth.getUser()` returns GoTrue user objects
- `supabase.auth.signOut()` invalidates GoTrue sessions
- Token refresh works through GoTrue's existing endpoint

SupaOAuth does not intercept or modify the `supabase-js` auth transport layer.

### SC-2: auth.users

When `runtime_mode=gotrue`, user identity lives in GoTrue's `auth.users` table:

- SupaOAuth metadata tables reference `auth.users.id` via foreign key
- SupaOAuth does not create a parallel user table
- User CRUD operations are proxied through the SupaCloud adapter to GoTrue
- SupaOAuth may extend user profiles in a separate metadata table keyed by `auth.users.id`

### SC-3: JWT Claims for RLS

Access tokens must preserve all claims that Supabase RLS policies depend on:

| Claim | Source | Usage |
| --- | --- | --- |
| `sub` | GoTrue | User identity in RLS policies |
| `role` | GoTrue | `anon` / `authenticated` role switch |
| `aud` | GoTrue | Token audience validation |
| `iss` | GoTrue | Issuer validation |
| `exp` | GoTrue | Token expiry |
| `app_metadata` | GoTrue | Custom RLS claims (e.g. `app_metadata.tenant_id`) |
| `user_metadata` | GoTrue | User profile claims |

SupaOAuth may add namespaced claims (e.g. `supaoauth:roles`, `supaoauth:org_id`) but must never remove or alter the above standard claims.

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

SupaOAuth Management API paths must not conflict with these. Management API uses a separate path prefix (e.g. `/api/v1/*` or a separate port).

### SC-6: Self-Hosted

SupaOAuth must work with self-hosted Supabase stacks:

- No dependency on Supabase Cloud control plane
- GoTrue, Kong, PostgREST, Storage, Realtime all run as self-hosted services
- SupaCloud orchestrates the self-hosted stack
- SupaOAuth Management API and Admin Console run independently

### SC-7: Dual Runtime Mode

**gotrue mode (default)**:
- GoTrue is the token issuer
- JWT is signed with the GoTrue JWT secret
- SupaOAuth is the control plane and BFF only
- All Supabase SDK flows work without modification

**external_oidc mode (advanced)**:
- An external IdP (SupaOAuth or third-party) is the token issuer
- Supabase is configured with third-party auth
- Requires OIDC discovery + asymmetric JWKS
- JWT claims must map to what Supabase RLS expects
- Must be explicitly enabled per project; not the default

## Optional-Compatible

### SC-8: Row Level Security Extensions

SupaOAuth may enhance RLS by adding namespaced claims:

- `supaoauth:roles` — SupaOAuth role names
- `supaoauth:org_id` — Current organization context
- `supaoauth:scopes` — Granted API scopes
- `supaoauth:permissions` — Resolved permission set

These claims are additive. They must not replace GoTrue's built-in claims.

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

SupaOAuth-added claims use the `supaoauth:` namespace:
- Will not appear in tokens when `runtime_mode=gotrue` (GoTrue controls claims)
- Only available when SupaOAuth can inject claims through GoTrue hooks or external OIDC
- RLS policies using `supaoauth:` claims must account for the claim being absent

## Verification Checklist

For each release, verify:

- [ ] `supabase-js` can sign in, get session, refresh token, sign out
- [ ] OAuth 2.1 metadata, authorization-code + PKCE, refresh-token, UserInfo, and unsupported-grant behavior pass `tests/integration/supabase-compat/oauth21.test.ts` against a real runtime
- [ ] `auth.users` is the primary identity table (no parallel user table in gotrue mode)
- [ ] JWT contains all required RLS claims (`sub`, `role`, `aud`, `iss`, `exp`, `app_metadata`, `user_metadata`)
- [ ] OIDC discovery document is accessible at `/.well-known/openid-configuration`
- [ ] OAuth authorization-server metadata is accessible at `/.well-known/oauth-authorization-server`
- [ ] JWKS is accessible at `/.well-known/jwks.json`
- [ ] Supabase API paths (`/auth/v1/*`, `/rest/v1/*`, `/storage/v1/*`, `/realtime/v1/*`) remain functional
- [ ] No management tokens or service-role keys appear in browser-visible code or `VITE_*` variables
- [ ] Self-hosted deployment works without Supabase Cloud
- [ ] `runtime_mode=gotrue` works with zero SupaOAuth-specific claims in the JWT
- [ ] `runtime_mode=external_oidc` provides valid OIDC discovery + asymmetric JWKS
