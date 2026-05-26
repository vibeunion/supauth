# SAML / Token Exchange / PAT / One-Time Token Decision Spike

## Decision Summary

- **SAML applications as IdP**: defer. Keep current Enterprise SSO SAML support as inbound connector/provider configuration, but do not make SupaOAuth a SAML IdP before GoTrue/OIDC GA is fully stable.
- **OAuth token exchange**: defer behind a dedicated external issuer mode. Token exchange can be valuable for service-to-service delegation, but it must not rewrite GoTrue session/token semantics.
- **Personal access tokens**: go for roadmap as a scoped management/runtime credential feature, implemented as SupaOAuth metadata plus revocable audit-backed records, not as GoTrue refresh tokens.
- **One-time tokens**: go only for narrow operational flows such as invitation acceptance, email/phone verification handoff, and recovery links. Do not expose general-purpose bearer one-time tokens.

## Compatibility Boundary

SupaOAuth's default runtime remains GoTrue:

- GoTrue issues OIDC JWTs, refresh tokens, JWKS, and user sessions.
- SupaOAuth may add control-plane records and policy metadata.
- New token-like features must not change `/auth/v1` behavior, Supabase client expectations, `auth.users`, or the standard JWT `role` claim.

## Capability Assessment

| Capability | Value | Compatibility risk | Decision |
| --- | --- | --- | --- |
| SAML application as IdP | Helps legacy enterprise apps consume SupaOAuth directly | High: requires SupaOAuth to become a signing/assertion runtime and operate cert rollover | Defer |
| OAuth token exchange | Useful for delegation between APIs and gateway/service workloads | Medium/high: requires issuer/audience/downscoping rules and replay controls | Defer |
| Personal access tokens | Useful for CLI, automation, SDK tests, and headless workflows | Medium: must be revocable and scoped, but can stay outside GoTrue sessions | Go, scoped roadmap |
| One-time tokens | Useful for invitations and recovery handoff | Medium: abuse risk if generalized | Go, narrow flows only |

## Implementation Notes For Accepted Items

PAT roadmap shape:

- `supaoauth.personal_access_tokens` with hashed token, owner user/application, scopes, org context, expiry, last used timestamp, revoked timestamp.
- Reveal token only once.
- Evaluate permissions through existing SupaOAuth RBAC helpers and application bindings.
- Add audit events for create/use/revoke and webhook notifications for revocation.

One-time token roadmap shape:

- Reuse purpose-specific tables where possible, such as organization invitations.
- Store only token hash and expiry.
- Mark consumed tokens immediately and audit the consuming request id.
- Do not allow arbitrary custom bearer token purposes without a new threat model.

## Follow-Up Tasks

- Add P1 task for scoped PAT model/API/Admin page after the current IdP control plane is stable.
- Add P2 task for one-time token hardening in invitations and recovery flows.
- Revisit SAML IdP and OAuth token exchange only after external issuer mode is documented and Supabase compatibility fixtures remain green.
