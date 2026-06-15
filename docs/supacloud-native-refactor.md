# SupaCloud-Native SupAuth Refactor

## Goal

SupAuth must run inside SupaCloud Functions without requiring or exposing any
additional long-running service such as `supauth.service`.

SupAuth is installed after SupaCloud creates a project. It depends on the
project-scoped environment injected by SupaCloud, including the internal
Management API URL/token, project ref, runtime URL, and project database URL.

SupaCloud is the source of truth for identity management APIs. SupAuth provides
the identity product surface on top of SupaCloud:

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
    /api/supauth/*
    /oauth/sso/authorize
    /v1/public/*

  SupaCloud Management API
    Applications
    Users
    Providers/connectors
    Organizations/RBAC
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
| Applications / OAuth clients | SupaCloud API | Facade, UI mapping, application-level hosted auth overlay |
| Users / sessions / identities / MFA | SupaCloud API / GoTrue | Account center facade, employee claim workflow, safe metadata updates |
| Providers / connectors | SupaCloud API | Login-page visibility, display order, tenant copy, safe defaults |
| Organizations / RBAC | SupaCloud API | UI facade and Supabase compatibility helpers |
| Audit | SupaCloud platform audit | SupAuth-only product events and correlation |
| Webhooks | SupaCloud platform webhooks | SupAuth-only event templates and UI facade |
| Branding / phrases / custom UI | SupAuth overlay on SupaCloud storage/config | Hosted page resolution and static assets |
| Runtime auth protocol | GoTrue | No token signing or authorization-code reimplementation |

## Migration Rules

1. Do not add new SupAuth tables for domains already owned by SupaCloud.
2. Prefer adding missing management capability to SupaCloud before adding a
   duplicate SupAuth repository.
3. Existing `supaoauth.*` tables must be classified as:
   - `supacloud-owned`: migrate or replace with SupaCloud API calls.
   - `supauth-overlay`: keep only if SupaCloud does not own the product field.
   - `legacy-temporary`: read for migration only, then remove.
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
- Management API facade routes for Applications/client secrets, Users/sessions,
  Organizations, RBAC, Audit, and Webhooks now call SupaCloud Management API
  through `packages/auth-server/src/supacloud/adapter.ts` instead of treating
  SupAuth local tables as the source of truth.
- User passkey routes now call SupaCloud user passkey APIs instead of writing a
  SupAuth passkey table.
- Webhook event dispatch now submits event envelopes to SupaCloud's managed
  webhook delivery pipeline. SupaCloud owns webhook storage, signing, retries,
  diagnostics, and disabling failing endpoints; SupAuth does not run a webhook
  worker or retry timer.
- Metadata sync reads effective roles and organization assignments from
  SupaCloud RBAC facade calls before patching GoTrue `app_metadata`.
- The SupaCloud app manifest now includes `supaoauth_table_ownership`,
  `supacloud_managed_background_jobs`, and `forbidden_runtime_forms` so the
  deploy contract records which local tables are overlay versus
  legacy-temporary migration state.
- Legacy management repositories for Applications secrets, Organizations,
  organization controls, account sessions, RBAC, RBAC bridge, and Webhooks are
  compatibility facades over SupaCloud Management API instead of local
  source-of-truth table writers.
- Hosted pages and public APIs are declared in the SupaCloud app manifest and
  route to SupaCloud Pages/Functions.
- `scripts/verify-supacloud-installed-app.ts` verifies an installed SupaCloud
  project from the generated manifest: SupAuth Function health, public hosted
  routes, hosted OAuth routes, Pages assets, and preserved Supabase runtime
  paths.

Remaining slices:

- Wire the SupaCloud deployment adapter to consume
  `artifacts/supacloud-app/supacloud-app-manifest.json` directly during project
  creation.
- Run `scripts/verify-supacloud-installed-app.ts` against a real SupaCloud
  project once platform credentials/fixture URLs are available, and attach the
  generated verification JSON to the release artifact.
