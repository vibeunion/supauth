# SupaCloud-Native SupAuth Refactor

## Goal

SupAuth must run inside SupaCloud Functions without requiring or exposing any
additional long-running service such as `supauth.service`.

SupAuth is installed after SupaCloud creates a project. It depends on the
project-scoped environment injected by SupaCloud, including the internal
Management API URL/token, project ref, runtime URL, and project database URL.

GoTrue is the source of truth for authentication runtime state. SupaCloud is
the source of truth for enterprise control-plane data. SupAuth provides the
identity product surface across those two authorities:

- Admin Console UI
- Hosted auth and account claim pages
- BFF/function handlers that protect internal SupaCloud credentials
- Product overlays not owned by SupaCloud
- Compatibility and migration helpers

## Target Runtime

```text
SupaCloud
  Pages/static hosting
    /admin/*
    /login.html
    /claim.html

  Functions
    /api/v1/*
    /oauth/sso/authorize
    /v1/public/*

  SupaCloud Management API
    Applications metadata
    Delegated GoTrue management facades
    Providers/connectors
    Business Organizations/RBAC/tenant collaborators
    Audit/Webhooks

  Supabase-compatible runtime
    /auth/v1/*
    /rest/v1/*
    /storage/v1/*
    /realtime/v1/*
    /functions/v1/*
```

All HTTP execution must go through the exported SupaCloud Function handler from
`packages/auth-server/src/supacloud-function.ts`. Local development uses
`bun run dev:function`, a SupaCloud Function emulator that invokes the same
`fetch` handler. There is no supported standalone SupAuth server entrypoint.

## Source of Truth

| Domain | Target owner | SupAuth responsibility |
| --- | --- | --- |
| Applications metadata | SupaCloud API | Facade, UI mapping and application-level hosted auth overlay |
| OAuth clients / client secret rotation | GoTrue | Delegated facade; no multi-secret store |
| `auth.users` / Identity / OAuth Grants | GoTrue | Admin user CRUD plus current-user Grant/opt-in identity actions only; no unsupported admin facade or copied source table |
| Session / Refresh Token / MFA | GoTrue | Scoped logout, user-token TOTP and supported admin MFA reset only; no session inventory or local factor, credential or session state |
| Providers / connectors | SupaCloud API | Login-page visibility, display order, tenant copy, safe defaults |
| Organizations / RBAC | SupaCloud API | UI facade and Supabase compatibility helpers |
| Audit | SupaCloud platform audit | SupAuth-only product events and correlation |
| Webhooks | SupaCloud platform webhooks | SupAuth-only event templates and UI facade |
| Branding / phrases / custom UI | SupAuth overlay on SupaCloud storage/config | Hosted page resolution and static assets |
| Runtime auth protocol / JWT / JWKS / `/auth/v1/*` | GoTrue | Preserve and verify; no token signing or authorization-code reimplementation |
| Connector/CAPTCHA/Webhook/Auth Hook secrets | SupaCloud Secret Manager | Masked state only; no browser disclosure |

## Migration Rules

1. Do not add new SupAuth tables for domains already owned by SupaCloud.
2. Prefer adding missing management capability to SupaCloud before adding a
   duplicate SupAuth repository.
3. Existing `supaoauth.*` tables must be classified as either
   `supauth-overlay` (an additive field neither authority owns) or
   `legacy-temporary` (migration identification only). SupaCloud- and
   GoTrue-owned data is never a new SupaOAuth table.
4. Browser code must never receive SupaCloud master tokens, service-role keys,
   connector secrets, or signing material.
5. Admin Console should keep a single `/api` surface even when the backing
   implementation is SupaCloud Functions.
6. Function handlers must share auth, audit, error, and request-id logic through
   common modules instead of duplicating per route.

## First Refactor Slice

Completed by this refactor slice:

- `packages/auth-server/src/index.ts` exports `handleSupAuthRequest()` and does
  not bind a port.
- `packages/auth-server/src/supacloud-function.ts` exports a SupaCloud Function
  `fetch` handler as the only HTTP runtime entrypoint.
- `scripts/dev-supauth-function.ts` provides a local Function emulator for
  development, not a standalone service.
- `scripts/export-openapi.ts` reads OpenAPI from the in-process handler without
  starting a service.
- `bun run build` is the only build entrypoint and generates a SupaCloud app manifest containing the
  Function bundle, Admin Pages directory, route bindings, required injected env,
  preserved Supabase runtime routes, migration command, and OpenAPI.
- Management API facade routes for Applications, Organizations, RBAC, Audit and
  Webhooks call SupaCloud Management API through
  `packages/auth-server/src/supacloud/adapter.ts` instead of treating SupAuth
  local tables as the source of truth.
- Admin Users 只提供 GoTrue/SupaCloud 可证实的用户、角色、日志与组织管理；
  stock GoTrue 不提供的管理员 session 列表、按 session ID 撤销、identity unlink
  与 OAuth Grant facade 已隐藏并返回 `capability_unavailable`。
- Account Center 使用当前用户 Bearer 直接调用 GoTrue 的 profile、OAuth Grants、
  由 `manual_linking_enabled` 单独 opt-in 的 identity linking/unlinking、TOTP
  与 scoped logout 能力，并读回 GoTrue 状态。实验性 linking-domain map 是
  另一项默认关闭的自动分组能力，不代替 manual ceremony gate。
- Legacy Passkey management routes are hidden from OpenAPI and return
  `capability_unavailable`; new installations do not create a credential table.
- Webhook event dispatch now submits event envelopes to SupaCloud's managed
  webhook delivery pipeline. SupaCloud owns webhook storage, signing, retries,
  diagnostics, and disabling failing endpoints; SupAuth does not run a webhook
  worker or retry timer.
- Metadata sync reads effective roles and organization assignments from
  SupaCloud RBAC facade calls before patching GoTrue `app_metadata`.
- The SupaCloud app manifest now includes `authority`,
  `gotrue_owned_runtime_domains`, `supacloud_owned_management_domains`,
  `supacloud_management_facades`, `supaoauth_table_ownership`,
  `supacloud_managed_background_jobs`, and `forbidden_runtime_forms` so the
  deploy contract records every authority and compatibility boundary.
- Legacy repositories are compatibility facades over the correct authority:
  SupaCloud for control-plane data and GoTrue for authentication runtime data.
  They do not write local source-of-truth tables.
- Hosted pages and public APIs are declared in the SupaCloud app manifest and
  route to SupaCloud Pages/Functions.
- `scripts/verify-supacloud-installed-app.ts` verifies an installed SupaCloud
  project from the generated manifest: SupAuth Function health, public hosted
  routes, hosted OAuth routes, Pages assets, and preserved Supabase runtime
  paths.

## Release Boundary

The local artifact and installed-app verifier are part of the release gate.
Running `scripts/verify-supacloud-installed-app.ts` against a real SupaCloud
project and attaching its JSON result happens only during an explicitly
authorized validation deployment; the current local delivery does not publish
or mutate a project.
