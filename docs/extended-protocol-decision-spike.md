# GoTrue-only Extended Protocol Decision

## Decision

SupaOAuth supports stock GoTrue as its only authentication runtime. Product
navigation, OpenAPI, migrations, and SDKs do not expose protocol surfaces that
would require SupaOAuth to become a second issuer or credential verifier.

| Capability | Product decision | Compatible alternative |
| --- | --- | --- |
| Outbound SAML application / IdP | Not supported | Use inbound SAML/OIDC Enterprise SSO managed by GoTrue/SupaCloud |
| RFC 8693 token exchange | Not supported | Use GoTrue authorization-code + PKCE or service credentials owned by the target service |
| Subject token | Not supported | Use purpose-specific GoTrue invitation, verification, and recovery flows |
| Personal access token | Not supported | Use normal GoTrue sessions for users and application credentials for M2M clients |
| MFA recovery code | Not supported | Use GoTrue-supported TOTP recovery and administrator factor reset |
| Arbitrary Inline Hook | Not supported | Use documented GoTrue Auth Hooks only |

Existing compatibility endpoints must return an explicit unsupported response
during their deprecation window. They must never mint a SupaOAuth token, create
a parallel session, or write a second MFA credential store.

## Release Gate

- `RUNTIME_MODE` accepts only `gotrue`.
- `/auth/v1/*`, discovery, JWKS, OAuth grants, sessions, refresh tokens, and MFA
  remain owned by GoTrue.
- OpenAPI and Admin Console contain no PAT, subject-token, outbound SAML,
  recovery-code, external issuer, or Inline Hook product entry.
- The live OAuth compatibility suite proves RFC 8693 remains unadvertised and
  is rejected by the GoTrue token endpoint.
