# Codex Agent Rules

## Project Identity
SupaOAuth is an **independent Identity Provider (IdP)** — a standalone user center comparable to Logto. It is NOT merely an admin panel for GoTrue configuration.

## Architecture Dependency
- **@svadmin/core** + **@svadmin/ui** → Admin console UI framework
- **@svadmin/sso** → Admin console's own authentication
- **SupaCloud Management API** → GoTrue instance orchestration, env injection, Kong routing
- **GoTrue** → The underlying OIDC-compliant auth engine (SupaOAuth orchestrates, not replaces)

## Key Principles
1. **Read `progress.md`** before starting any work — tasks and context live there.
2. **Check `.mailbox/`** for inter-agent messages.
3. **No scope reduction** — if a task expands beyond the original request, stop and ask.
4. **Verify first** — run `bunx tsc --noEmit` and `bun test` before marking tasks complete.
5. **No secrets** — never hardcode API keys or tokens.

## Package Structure
```
packages/
  auth-server/     # Elysia/Bun Management API + BFF + SupaCloud adapter + metadata APIs
  admin-console/   # SvelteKit + @svadmin/core management UI
  shared/          # Shared schemas and types
  sdks/            # Client SDKs
```

## Integration Boundary
- SupaOAuth **owns**: Application registration, Resource/Scope definitions, Role/Permission model, Organization model, Connector model, Sign-in Experience config, Audit log, Webhooks, SDKs, Management API, Runtime health verification
- SupaOAuth **delegates to SupaCloud**: GoTrue env injection, GoTrue restart, Kong route setup, user CRUD proxy, MFA proxy
- SupaOAuth **does NOT**: Reimplement OIDC token signing (GoTrue does this), manage Postgres directly, manage Kong configs directly, expose management credentials to browser code
