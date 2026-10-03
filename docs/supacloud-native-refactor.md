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

## Historical Phase: Generated Application Composition

This section records the initial Elysia 1 composition slice. Its narrower
non-goals and acceptance results are superseded by the approved migration below.

### Goal and Non-goals

This phase targets `@supacloud/app@0.21.0` and `@supacloud/compiler@0.30.0`.
It replaces the former blanket rejection of the application framework with a
bounded composition migration, not a wholesale rewrite.

- Define modules under `packages/auth-server/src/app` using `defineModule`:
  Root imports the `supauth-function` Feature module.
- Move the HTTP application assembly from `packages/auth-server/src/index.ts`
  into a factory in `packages/auth-server/src/http-application.ts`. Generated
  factories must invoke that factory to create the actual HTTP application;
  `index.ts` obtains it through generated typed services rather than retaining
  an independent assembly path.
- Limit the new compiler's strict scan to `**/*.ts` under the explicit
  `packages/auth-server/src/app` root. Existing business code is outside this compiler
  phase but must remain in the normal project type-checking gate.
- Integrate `app:compile` and `app:compile:check` into the Function build/check
  flow so generated composition is required by the artifact flow.

Non-goals are changing Elysia 1.4 routes/guards, Function request normalization,
the manifest or installer contract, and GoTrue authentication semantics.
Do not introduce `@supacloud/elysia@0.23` in this phase: its Elysia 2 beta
requirement is outside this phase's runtime boundary. Controller/command
migration is not complete, and neither agent-tool exposure of security endpoints
nor new authentication state ownership is authorized.

### Delegation and Verification

Use the `pipeline` collaboration mode: `explorer -> executor -> verifier ->
orchestrator`. The explorer establishes module/factory and compatibility
boundaries; executors own explicitly assigned implementation or documentation
files in isolated contexts; the verifier independently checks generated
composition and preserved behavior; the orchestrator consolidates evidence and
reports implementation, verification, deployment, and online acceptance separately.

The executor/docs subtask owns only the `@supacloud/app` Architectural Decision
section in `docs/architecture.md` and this migration phase section. Its
`safe_skip_reason` for further delegation is documentation-only scope.
Its verification command is `git diff --check`; its handoff is `changed/evidence`
in the final tool result, used as the mailbox without writing another file.
Compiler, Function build, and behavioral verification belong to the corresponding
implementation/verifier handoffs, not to this documentation check.

### Acceptance Criteria

The following three scenarios are acceptance requirements, not recorded results.

```gherkin
Scenario: Generated composition creates the HTTP application
  Given @supacloud/app 0.21.0 and @supacloud/compiler 0.30.0
    And src/app defines Root -> supauth-function Feature with defineModule
  When the Function entry resolves the application through index.ts
  Then generated factories invoke the http-application.ts factory
    And index.ts consumes generated typed services without a separate HTTP assembly path

Scenario: Compiler strict scope and project type checks remain distinct
  Given the compiler strict scan is limited to the src/app root
    And existing business code remains in the normal project type gate
  When the Function build/check flow runs
  Then app:compile:check runs before the Function bundle is built
    And app:compile is the explicit regeneration command, not an automatic repair
    And stale or invalid generated composition fails the check
    And legacy business code is not added to this phase's compiler scan or exempted from project type checks

Scenario: Existing authentication and installation boundaries are preserved
  Given the existing Elysia 1.4 routes and guards
  When requests pass through the SupaCloud Function and artifacts use the manifest/installer contract
  Then Function request normalization and route/guard behavior remain unchanged
    And GoTrue semantics and the manifest/installer contract remain unchanged
    And @supacloud/elysia 0.23 and Elysia 2 beta are not introduced
```

### Risk, Rollback, and Remaining Work

Primary risks are duplicate or bypassed HTTP assembly, changed initialization
order, generated output drift, and accidentally dropping old business code from
the project type gate. Review must distinguish actual generated factory execution
from metadata that is generated but never used.

Rollback must revert only this phase's composition changes: module declarations,
generated wiring, the HTTP factory extraction, and related compiler configuration,
scripts, and phase-specific dependencies. Restore the prior HTTP assembly path
while preserving the preceding SDK upgrade and unrelated work; do not reset the
shared working tree or roll back the earlier SDK phase.

Full controller/command migration and online acceptance remain unfinished.
This section records the target and acceptance contract only; it does not assert
that implementation, tests, deployment, or live acceptance have completed.

### Compiler Compatibility and Local Evidence

The pinned compiler's CLI and API generator templates need the checked-in
`patches/@supacloud%2Fcompiler@0.30.0.patch`: generated helpers must use bracket
access for index-signature properties under `noPropertyAccessFromIndexSignature`.
The patch changes property-access syntax only. Keep the strict TypeScript option
enabled and regenerate artifacts; do not patch generated files by hand. Recheck
whether the patch is still needed when upgrading the compiler.

Local verification of this composition slice passed:

- `bun --no-env-file test tests/supacloud-framework-migration.test.ts`: five
  cases, including source and built Function behavior, strict artifact drift,
  authentication denial, request IDs, security headers, CORS, and compiled
  module lifecycle/rollback.
- `bun --no-env-file run --filter '@supauth/auth-server' typecheck`.
- `git diff --check`.

These checks do not establish full application artifact acceptance or behavior
against a live GoTrue/SupaCloud project. No deployment is included in this slice.

### Full Migration Follow-up Contract

User follow-up: complete the remaining architecture migration, rather than
declare the composition slice a full migration. Collaboration remains a pipeline
with independent exploration, scoped execution, verification, and consolidation.

- Goal: compiled Controller ownership, explicit privileged application services,
  and complete module lifecycle
  management, while retaining the existing HTTP/security behavior.
- Non-goals: replacing GoTrue, transferring data ownership, or publishing,
  committing, pushing, deploying, or modifying a live project.
- Scope: `packages/auth-server/src/app`, its HTTP entry and generated artifacts,
  directly affected route contracts/dependencies, and the migration test.
- Compatibility gate: establish the published adapter's Elysia/plugin support,
  native-hook semantics, cookies, multipart handling, and schema compatibility
  before replacing the HTTP stack. Metadata-only wrappers do not count as
  framework migration.
- Acceptance: every migrated route retains its contract and authorization;
  all modules initialize in dependency order and tear down in reverse order;
  startup failures roll back initialized resources without losing the cause.
- Verification: the migration test file, scoped auth-server typecheck,
  compiler drift validation, and `git diff --check`. Do not run a full suite.
- Rollback: retain the preceding composition and SDK changes. Revert only
  this follow-up's changes if compatibility cannot be demonstrated.

The primary sources are the pinned packages' shipped compiler/adapter contracts
and the SupaCloud repository's Elysia compatibility and conformance documents.
Unsupported transport/security semantics must remain explicitly unresolved,
not be replaced by no-op guards, fabricated command metadata, or unsafe casts.

### Follow-up Status and Compatibility Decision

The user explicitly accepted the Elysia 2 beta runtime replacement on
2026-10-03. The implementation now uses `@supacloud/elysia@0.23.0`,
Elysia `2.0.0-beta.19`, and `typebox@1.3.34`. The earlier Elysia 1 composition
is a rollback baseline, not the final target.

The entry now constructs every compiled module and passes previously created
services to subsequent module factories. It exposes readiness and idempotent
shutdown, initializes module hooks and application initializers, and tears down
modules in reverse order. Initialization failures trigger cleanup and retain
both the original and cleanup errors. Requests wait for readiness; shutdown
rejects new requests and drains active handlers before releasing services.
Hosts may call the exported `close()`; no process signal handler or listener is
installed by the Function.

The HTTP migration consists of:

- 45 real Controllers owning all 270 business routes, registered exclusively by
  the official compiled adapter. Four explicit infrastructure routes preserve
  documentation and preflight; derived HEAD aliases retain Elysia 1 behavior.
- 106 injectable privileged Actions. Each checks the existing action permission
  before calling its authority-owned operation. These are deliberately not
  `@Command` declarations: that decorator requires real persistent adapters,
  receipts, audit and idempotency policy. Inventing a second ledger or falsely
  claiming remote idempotency would violate the existing ownership contract.
  No compiler command policy is disabled.
- Explicit domain contract execution, including final account receipt checks,
  response validation, 400/422/502 distinctions, native Responses, and raw binary
  bodies. Signed auth hooks verify before parsing and consume the verifier once.
- Replacement CORS and Scalar/OpenAPI infrastructure. Unknown origins are never
  reflected with credentials, multiple cookies remain separate, and known
  origins can read correlation headers. The document is built from the same
  operation definitions used by Controllers, not a separate old router.
- Shared `@sinclair/typebox` schemas remain the domain decoder's authority.
  Framework transport declarations use explicit domain/native-response
  ownership; no schema casts between TypeBox versions or disabled validation
  are used.
- `patches/elysia@2.0.0-beta.19.patch` repairs published declaration constraints
  under the project's strict TypeScript settings. It changes no runtime code.
  Reassess both this patch and the compiler patch on future upgrades.

The migration test compares the source and actual Function bundle against the
274-route pre-migration fixture, checks OpenAPI paths/methods/statuses, authentication
and denial, public hosted/SSO paths, HEAD, CORS, protocol validation, native
responses, direct Action permissions, and lifecycle rollback/draining.
Tests of isolated business groups now use a test-only Elysia 2 adapter; production
contains no compatibility dispatcher or old-router mount.

Local verification is not online acceptance. Live upstream writes, tenant
configuration, complete application installation, and production authentication
remain subject to the separately authorized release procedure.

### Local Verification (2026-10-03)

- Registry read-back confirmed `@supacloud/app@0.21.0`,
  `@supacloud/compiler@0.30.0`, and `@supacloud/elysia@0.23.0` as their
  respective `latest` tags; the adapter requires `elysia@2.0.0-beta.19`.
- `bun --no-env-file test tests/supacloud-framework-migration.test.ts`:
  6 passed, 0 failed. This includes strict compiler drift checking and a
  fresh Function bundle, not just source-level routing.
- `bun --no-env-file run --filter '@supauth/auth-server' typecheck`:
  exit 0 with strict declaration checking retained.
- `git diff --check`: exit 0.
- Review fixes covered HEAD audit permissions (403 with zero upstream calls
  for a read-only principal), unknown-origin CORS exposure, and configuration
  redirect metadata (matching Location/body returns 302; mismatch returns 502
  without executing the handler again).
- Independent cross-review of the final permission and metadata fixes found
  no remaining blockers; the verifier also passed the focused domain case,
  scoped auth-server typecheck, and whitespace check.
- Full `bun --no-env-file run build` and
  `bun --no-env-file run verify:artifact` passed after the release-artifact
  follow-up, with zero artifact errors or warnings. The initial artifact
  check exposed three Elysia synchronous loader fallbacks prohibited by the
  multi-tenant Edge Runtime. The Function build now statically bundles the
  real TypeBox and exact-mirror modules while retaining injection, caches,
  and the shared TypeBox system instance. No artifact safety check was relaxed.
- The migration test was rerun after that build fix: 6 passed, 0 failed,
  including a new module-lexer assertion rejecting non-metadata `import.meta`
  access in the freshly built bundle. Independent source review found no
  blocker in the static mapping; future Elysia upgrades must recheck its
  source-structure assumptions.

No full suite, deployment, production mutation, or live upstream acceptance was
performed. Valid signed-webhook replay rejection and streamed response-body
shutdown draining are not established by this local migration test; shutdown
draining covers active handler promises. The accepted beta dependency and its
declaration-only patch remain release considerations.

## Release Boundary

The local artifact and installed-app verifier are part of the release gate.
Running `scripts/verify-supacloud-installed-app.ts` against a real SupaCloud
project and attaching its JSON result happens only during an explicitly
authorized validation deployment; the current local delivery does not publish
or mutate a project.

Release preparation also identified an existing independent blocker in
`scripts/release-gate.ts`: the live path stops with
`LEGACY_COMPAT_FIXTURE_OWNERSHIP_REQUIRED` after representative contract
acceptance. OAuth/MFA/Storage/Realtime compatibility fixtures need explicit
ownership and cleanup before that production gate can complete. Do not remove
the guard or substitute mocked migration tests for live acceptance. Integrate
the migration into a clean candidate based on current main before release;
the original branding branch's already-merged PR does not contain these changes.
