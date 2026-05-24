# SupaOAuth

[English](#english) | [中文](#中文)

## English

SupaOAuth is an independent Identity Provider (IdP) — a standalone user center comparable to Logto. It orchestrates authentication, authorization, and user management for business applications while remaining compatible with the Supabase ecosystem.

It is not a thin admin panel for GoTrue environment variables.

### Architecture

Three explicit layers:

1. **Supabase-compatible runtime** — GoTrue, Kong, and Supabase API paths handle OIDC/OAuth protocol, JWT signing, `auth.users`, and RLS-compatible claims.
2. **Logto-like product control plane** — SupaOAuth owns Applications, API Resources, Scopes, Roles, Organizations, Connectors, Sign-in Experience, Audit, Webhooks, and Management API/SDKs.
3. **SupaCloud orchestration** — Applies product intent to GoTrue env injection, Kong routes, instance lifecycle, user/MFA proxy.

SupaOAuth does not reimplement OIDC token signing or authorization-code issuance. GoTrue handles the protocol runtime. SupaOAuth is the control plane, BFF, metadata owner, and runtime verifier.

See [docs/architecture.md](docs/architecture.md) for full details.

### Supabase Compatibility

Compatibility is a hard requirement. SupaOAuth must not break:

- `supabase-js` auth flows
- `auth.users` as primary identity (gotrue mode)
- JWT claims needed by RLS (`sub`, `role`, `aud`, `iss`, `exp`, `app_metadata`, `user_metadata`)
- OIDC discovery and JWKS endpoints
- Supabase API paths (`/auth/v1/*`, `/rest/v1/*`, `/storage/v1/*`, `/realtime/v1/*`)
- Self-hosted deployment via SupaCloud

See [docs/supabase-compatibility.md](docs/supabase-compatibility.md) for the full spec.

### Package Structure

```text
packages/
  auth-server/     # Elysia/Bun Management API + BFF + SupaCloud adapter + metadata APIs
  admin-console/   # SvelteKit + @svadmin/core management UI
  shared/          # Shared schemas and types
  sdks/typescript/ # Management API client SDK
```

Root `src/` is a thin sync of `packages/admin-console/src/` for backward compatibility.

### Quick Start

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

### Environment

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

Optional P0-9 live OAuth 2.1 compatibility fixture:

```sh
RUN_SUPABASE_RUNTIME_COMPAT=0
RUN_SUPABASE_OAUTH21_COMPAT=0
OAUTH21_CLIENT_ID=<registered-oauth-client-id>
OAUTH21_REDIRECT_URI=http://localhost:3000/oauth/callback
OAUTH21_ACCESS_TOKEN=<optional-oauth-access-token>
OAUTH21_REFRESH_TOKEN=<optional-oauth-refresh-token>
OAUTH21_TOKEN_AUTH_METHOD=none
OAUTH21_CLIENT_SECRET=<optional-client-secret>
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

## 中文

SupaOAuth 是一个独立身份提供方（IdP），定位是类似 Logto 的独立用户中心。它为业务应用编排认证、授权和用户管理，同时保持对 Supabase 生态的兼容。

它不是 GoTrue 环境变量的轻量管理面板。

### 架构

系统分为三层：

1. **Supabase 兼容 runtime** — GoTrue、Kong 和 Supabase API 路径负责 OIDC/OAuth 协议、JWT 签名、`auth.users` 和 RLS 兼容 claims。
2. **类似 Logto 的产品控制面** — SupaOAuth 自持 Applications、API Resources、Scopes、Roles、Organizations、Connectors、Sign-in Experience、Audit、Webhooks，以及 Management API/SDKs。
3. **SupaCloud 编排层** — 将产品意图落到 GoTrue env 注入、Kong 路由、实例生命周期、用户/MFA 代理等能力上。

SupaOAuth 不重新实现 OIDC token 签名或 authorization code 签发。协议 runtime 由 GoTrue 负责；SupaOAuth 是控制面、BFF、metadata owner 和 runtime verifier。

完整说明见 [docs/architecture.md](docs/architecture.md)。

### Supabase 兼容性

兼容性是硬性要求。SupaOAuth 不能破坏：

- `supabase-js` auth flows
- `auth.users` 作为主身份表（gotrue mode）
- RLS 所需的 JWT claims（`sub`、`role`、`aud`、`iss`、`exp`、`app_metadata`、`user_metadata`）
- OIDC discovery 和 JWKS endpoints
- Supabase API 路径（`/auth/v1/*`、`/rest/v1/*`、`/storage/v1/*`、`/realtime/v1/*`）
- 通过 SupaCloud 支持 self-hosted 部署

完整规范见 [docs/supabase-compatibility.md](docs/supabase-compatibility.md)。

### 包结构

```text
packages/
  auth-server/     # Elysia/Bun Management API + BFF + SupaCloud adapter + metadata APIs
  admin-console/   # SvelteKit + @svadmin/core management UI
  shared/          # Shared schemas and types
  sdks/typescript/ # Management API client SDK
```

根目录 `src/` 是 `packages/admin-console/src/` 的轻量同步，用于保留向后兼容。

### 快速开始

安装依赖，并从 `.env.example` 创建 `.env`：

```sh
bun run setup
```

填写 `.env` 中的 SupaCloud 配置，然后初始化 SupaCloud Postgres 中的 metadata schema：

```sh
bun run migrate
```

同时启动 auth-server 和 admin console：

```sh
bun run dev
```

Admin console 运行在 `http://localhost:5173/admin`。开发时 Vite 会把 `/api/*` 代理到 `http://localhost:4000/*`，所以浏览器代码仍使用 `VITE_AUTH_SERVER_URL=/api`。

常用命令：

```sh
bun run dev:server   # 只启动 auth-server
bun run dev:admin    # 只启动 admin-console
bun run build        # 构建所有 packages
bun run check        # typecheck + tests + admin-console build
```

### 环境变量

Auth server（仅服务端使用，不加 `VITE_` 前缀）：

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

可选的 P0-9 live OAuth 2.1 兼容性测试配置：

```sh
RUN_SUPABASE_RUNTIME_COMPAT=0
RUN_SUPABASE_OAUTH21_COMPAT=0
OAUTH21_CLIENT_ID=<registered-oauth-client-id>
OAUTH21_REDIRECT_URI=http://localhost:3000/oauth/callback
OAUTH21_ACCESS_TOKEN=<optional-oauth-access-token>
OAUTH21_REFRESH_TOKEN=<optional-oauth-refresh-token>
OAUTH21_TOKEN_AUTH_METHOD=none
OAUTH21_CLIENT_SECRET=<optional-client-secret>
```

Admin console（浏览器侧）：

```sh
VITE_AUTH_SERVER_URL=/api
```

不要把 management token 或 service-role key 放进任何 `VITE_*` 变量。

可选项：

```sh
SUPACLOUD_STORAGE_URL=http://localhost:8000
AUTH_SERVER_PROXY_TARGET=http://localhost:4000
```
