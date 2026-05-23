# SupaOAuth

SupaOAuth is an independent Identity Provider (IdP) — a standalone user center comparable to Logto. It orchestrates authentication, authorization, and user management for business applications while remaining compatible with the Supabase ecosystem.

It is not a thin admin panel for GoTrue environment variables.

## Architecture

Three explicit layers:

1. **Supabase-compatible runtime** — GoTrue, Kong, and Supabase API paths handle OIDC/OAuth protocol, JWT signing, `auth.users`, and RLS-compatible claims.
2. **Logto-like product control plane** — SupaOAuth owns Applications, API Resources, Scopes, Roles, Organizations, Connectors, Sign-in Experience, Audit, Webhooks, and Management API/SDKs.
3. **SupaCloud orchestration** — Applies product intent to GoTrue env injection, Kong routes, instance lifecycle, user/MFA proxy.

SupaOAuth does not reimplement OIDC token signing or authorization-code issuance. GoTrue handles the protocol runtime. SupaOAuth is the control plane, BFF, metadata owner, and runtime verifier.

See [docs/architecture.md](docs/architecture.md) for full details.

## Supabase Compatibility

Compatibility is a hard requirement. SupaOAuth must not break:

- `supabase-js` auth flows
- `auth.users` as primary identity (gotrue mode)
- JWT claims needed by RLS (`sub`, `role`, `aud`, `iss`, `exp`, `app_metadata`, `user_metadata`)
- OIDC discovery and JWKS endpoints
- Supabase API paths (`/auth/v1/*`, `/rest/v1/*`, `/storage/v1/*`, `/realtime/v1/*`)
- Self-hosted deployment via SupaCloud

See [docs/supabase-compatibility.md](docs/supabase-compatibility.md) for the full spec.

## Package Structure

```
packages/
  auth-server/     # Elysia/Bun Management API + BFF + SupaCloud adapter + metadata APIs
  admin-console/   # SvelteKit + @svadmin/core management UI
  shared/          # Shared schemas and types
  sdks/typescript/ # Management API client SDK
```

Root `src/` is a thin sync of `packages/admin-console/src/` for backward compatibility.

## Quick Start

Install dependencies and create `.env` from `.env.example`:

```sh
bun run setup
```

Edit `.env` with your SupaCloud values, then initialize the metadata schema in SupaCloud Postgres:

```sh
bun run migrate
```

Start auth-server and admin console together:

```sh
bun run dev
```

The admin console runs on `http://localhost:5173/admin`. During development, Vite proxies `/api/*` to `http://localhost:4000/*`, so browser code still uses `VITE_AUTH_SERVER_URL=/api`.

Useful commands:

```sh
bun run dev:server   # auth-server only
bun run dev:admin    # admin-console only
bun run build        # all packages
bun run check        # typecheck + tests + admin-console build
```

## Environment

Auth server (server-side only, no `VITE_` prefix):

```sh
PORT=4000
HOST=0.0.0.0
SUPACLOUD_API_URL=http://localhost:9090
SUPACLOUD_MASTER_TOKEN=<never-expose-to-browser>
PROJECT_REF=<your-project>
OAUTH_RUNTIME_URL=http://localhost:9999
RUNTIME_MODE=gotrue
DATABASE_URL=postgres://supaoauth:password@localhost:5432/supabase
CORS_ORIGINS=http://localhost:5173
ADMIN_TOKEN=<development-admin-token>
LOG_LEVEL=info
```

Admin console (browser-side):

```sh
VITE_AUTH_SERVER_URL=/api
```

No management tokens or service-role keys in `VITE_*` variables.

Optional:

```sh
SUPACLOUD_STORAGE_URL=http://localhost:8000
AUTH_SERVER_PROXY_TARGET=http://localhost:4000
```
