# External OIDC Mode

SupaOAuth supports two runtime modes. The default `gotrue` mode uses GoTrue as the token issuer. The `external_oidc` mode allows SupaOAuth or another IdP to issue tokens that Supabase trusts through its third-party auth feature.

## When to Use External OIDC Mode

- You want SupaOAuth to be the primary IdP, not just a management layer over GoTrue
- You need an external issuer that Supabase trusts while still preserving Supabase access-token claims
- You want to integrate with an enterprise IdP (Okta, Azure AD, etc.) that SupaOAuth proxies
- You need OIDC features that GoTrue doesn't support (e.g. custom grant types, resource indicators)

## Requirements

External OIDC mode has strict requirements to maintain Supabase compatibility:

1. **Asymmetric key signing** — The issuer MUST use RS256, ES256, or another asymmetric algorithm. HS256 (shared secret) is not supported for third-party auth.

2. **OIDC Discovery** — The issuer MUST expose a valid `/.well-known/openid-configuration` endpoint.

3. **JWKS Endpoint** — The issuer MUST expose `/.well-known/jwks.json` with public keys for JWT verification.

4. **Required claims** — Tokens that are meant to behave like Supabase access tokens MUST preserve the Supabase Auth required claim shape: `iss`, `aud`, `exp`, `iat`, `sub`, `role`, `aal`, `session_id`, `email`, `phone`, and `is_anonymous`. Authorization-safe metadata remains in `app_metadata` when present. The top-level `role` remains a Supabase runtime role (`anon`, `authenticated`, or `service_role`), not an enterprise business role.

5. **Supabase third-party auth configuration** — The Supabase project must be configured to trust the external issuer via the `auth.third_party_auth` table or SupaCloud API.

## Architecture

```
gotrue mode (default):

  App → supabase-js → GoTrue → JWT (HS256, GoTrue JWT secret)
                              → Supabase RLS works out of the box

external_oidc mode:

  App → supabase-js → GoTrue (third-party auth) → JWT (RS256, external JWKS)
                                                   → Supabase validates via JWKS
                                                   → RLS policies keep the app_metadata.supaoauth shape
```

## Configuration

### SupaOAuth Auth Server

```env
RUNTIME_MODE=external_oidc
# The issuer URL that appears in the JWT "iss" claim
OAUTH_ISSUER=https://auth.example.com
# Path to the private key (PEM format, RSA or EC)
OIDC_SIGNING_KEY_PATH=/etc/supaoauth/signing-key.pem
```

### Supabase / GoTrue

Configure Third-party Auth through the SupaCloud Management API apply tool. The
tool validates discovery, issuer/JWKS agreement, and asymmetric signing keys,
then performs a live read-back after the update:

```bash
bun run tenant:apply-third-party-auth -- \
  --base-url http://127.0.0.1:9090 \
  --project-ref your-project-id \
  --config config/third-party-auth/tenant.json \
  --dry-run

SUPACLOUD_API_TOKEN=... bun run tenant:apply-third-party-auth -- \
  --base-url http://127.0.0.1:9090 \
  --project-ref your-project-id \
  --config config/third-party-auth/tenant.json
```

Issuer, client ID, audience, upstream and claim mapping are tenant deployment
configuration. They must not be compiled into SupaOAuth defaults. Do not put a
shared JWT secret in this configuration or downgrade an asymmetric issuer to
HS256.

The equivalent underlying configuration is:

```sql
INSERT INTO auth.third_party_auth (project_id, provider_type, issuer, authorized_client_ids)
VALUES (
  'your-project-id',
  'oidc',
  'https://auth.example.com',
  ARRAY['your-client-id']
);
```

### SupaCloud Routes

This document describes the historical external OIDC design. The current
SupaCloud-native target keeps `/auth/v1/*` on GoTrue and installs SupAuth only
as SupaCloud Functions/Pages from `supacloud-app-manifest.json`.

For the current target, SupaCloud route bindings must preserve:
- `/auth/v1/*` → SupaCloud managed GoTrue runtime
- `/rest/v1/*`, `/storage/v1/*`, `/realtime/v1/*`, `/functions/v1/*` → SupaCloud managed runtime
- `/api/*`, `/v1/public/*`, `/oauth/*`, `/login`, `/login.html`, `/authorize.html`, `/claim`, `/claim.html` → SupAuth Function
- `/admin/*` → SupAuth Pages

SupAuth does not require a standalone auth server or a separately managed
gateway route layer.

## Token Flow

1. App authenticates with the configured external issuer.
2. The issuer signs a token that preserves the Supabase access-token shape.
3. Supabase/GoTrue validates the token using the configured third-party issuer and JWKS.
4. App uses the resulting Supabase-compatible session with `supabase-js` or directly against Supabase APIs.
5. RLS policies continue to use `auth.uid()`, `auth.jwt()`, and `app_metadata.supaoauth` where enterprise authorization is enabled.

For Supabase compatibility, prefer `app_metadata.supaoauth` for roles, organization context, version markers, and bounded permission projection. Top-level `supaoauth:*` claims are a legacy/advanced escape hatch only; enabling them requires explicit project documentation, token-size review, and RLS policy review.

## Limitations

- Not all GoTrue features work in third-party auth mode (e.g. GoTrue-managed sessions, GoTrue password reset flows)
- `supabase-js` auth methods that depend on GoTrue sessions may not work directly
- The app must use the external IdP's auth flow for sign-in/sign-up
- Token refresh is handled by the external IdP, not GoTrue

## Fallback to gotrue Mode

If external_oidc mode is causing compatibility issues, switch back:

```env
RUNTIME_MODE=gotrue
```

All SupaOAuth metadata (roles, organizations, scopes) remains accessible through the Management API. Claims can still be synced to `app_metadata` through the SupaCloud adapter.
