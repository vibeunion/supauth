# External OIDC Mode

SupaOAuth supports two runtime modes. The default `gotrue` mode uses GoTrue as the token issuer. The `external_oidc` mode allows SupaOAuth or another IdP to issue tokens that Supabase trusts through its third-party auth feature.

## When to Use External OIDC Mode

- You want SupaOAuth to be the primary IdP, not just a management layer over GoTrue
- You need SupaOAuth-specific claims (roles, organizations, scopes) in the JWT itself
- You want to integrate with an enterprise IdP (Okta, Azure AD, etc.) that SupaOAuth proxies
- You need OIDC features that GoTrue doesn't support (e.g. custom grant types, resource indicators)

## Requirements

External OIDC mode has strict requirements to maintain Supabase compatibility:

1. **Asymmetric key signing** — The issuer MUST use RS256, ES256, or another asymmetric algorithm. HS256 (shared secret) is not supported for third-party auth.

2. **OIDC Discovery** — The issuer MUST expose a valid `/.well-known/openid-configuration` endpoint.

3. **JWKS Endpoint** — The issuer MUST expose `/.well-known/jwks.json` with public keys for JWT verification.

4. **Required claims** — Tokens MUST include `sub`, `aud`, `iss`, and `exp` at minimum. For Supabase RLS compatibility, they SHOULD also include `role` and `app_metadata`.

5. **Supabase third-party auth configuration** — The Supabase project must be configured to trust the external issuer via the `auth.third_party_auth` table or SupaCloud API.

## Architecture

```
gotrue mode (default):

  App → supabase-js → GoTrue → JWT (HS256, GoTrue JWT secret)
                              → Supabase RLS works out of the box

external_oidc mode:

  App → supabase-js → GoTrue (third-party auth) → JWT (RS256, external JWKS)
                                                   → Supabase validates via JWKS
                                                   → RLS policies access supaoauth: claims
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

Configure third-party auth through the SupaCloud adapter or directly:

```sql
INSERT INTO auth.third_party_auth (project_id, provider_type, issuer, authorized_client_ids)
VALUES (
  'your-project-id',
  'oidc',
  'https://auth.example.com',
  ARRAY['your-client-id']
);
```

### Kong Routes

In external_oidc mode, Kong must route:
- `/.well-known/openid-configuration` → SupaOAuth auth-server (or the external IdP)
- `/.well-known/jwks.json` → SupaOAuth auth-server (or the external IdP)
- `/auth/v1/*` → GoTrue (still handles session management)

## Token Flow

1. App redirects to SupaOAuth authorization endpoint
2. SupaOAuth authenticates the user (via configured connectors)
3. SupaOAuth issues an authorization code
4. App exchanges the code for tokens at SupaOAuth's token endpoint
5. SupaOAuth signs the JWT with its private key
6. App uses the JWT with `supabase-js` or directly against Supabase APIs
7. GoTrue validates the JWT using the JWKS endpoint
8. Supabase RLS policies can reference `supaoauth:*` claims in the JWT

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
