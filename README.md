# SupaOAuth

[English](#english) | [中文](#中文)

## English

SupaOAuth is a SupaCloud-hosted enterprise IAM and user-center surface comparable to Logto. In the default `runtime_mode=gotrue`, it enhances Supabase Auth instead of replacing it: GoTrue keeps the OAuth/OIDC protocol runtime, JWT signing, refresh tokens, MFA, sessions, and `auth.users`, while SupaOAuth provides hosted UI, Admin Console, organization/RBAC governance, audit, configuration, and compatibility tooling.

It is not a thin admin panel for GoTrue environment variables.

The default product contract is upstream-compatible enhancement: a SupaOAuth
installation must run against the stock upstream GoTrue/Supabase Auth runtime
managed by SupaCloud. It may use documented GoTrue/Supabase extension points,
SupaCloud Management API, SupaCloud Functions/Pages, and official Supabase SDKs,
but must not require a SupaOAuth-patched GoTrue binary, custom `/auth/v1/*`
semantics, or forked `@supabase/supabase-js` / Auth UI packages.

### Architecture

Three explicit layers:

1. **Supabase-compatible runtime** — GoTrue, Kong, and Supabase API paths handle OIDC/OAuth protocol, JWT signing, `auth.users`, and RLS-compatible claims.
2. **Logto-like product surface** — SupaOAuth provides the Admin Console, hosted pages, SDKs, and overlay APIs while calling SupaCloud Management API for Applications, Users, Organizations, RBAC, Audit, Webhooks, and Providers.
3. **SupaCloud orchestration** — Owns the Management API source of truth and applies GoTrue env injection, Kong routes, instance lifecycle, user/MFA proxy, webhook delivery, and managed background jobs.

SupaOAuth does not reimplement OIDC token signing or authorization-code issuance. GoTrue handles the protocol runtime. SupaOAuth is the SupaCloud Function BFF, product overlay owner, SDK/API facade, and runtime verifier.

See [docs/architecture.md](docs/architecture.md) for full details.

### Supabase Compatibility

Compatibility is a hard requirement. SupaOAuth must not break:

- `supabase-js` auth flows
- `auth.users` as primary identity (gotrue mode)
- JWT claims needed by RLS and Supabase Auth hooks (`iss`, `aud`, `exp`, `iat`, `sub`, `role`, `aal`, `session_id`, `email`, `phone`, `is_anonymous`) plus preserved metadata claims (`app_metadata`, `user_metadata`)
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
  sdks/auth-ui/    # Supabase Auth UI adapter (React/Svelte)
```

Root `src/` is a thin sync of `packages/admin-console/src/` for backward compatibility.

### Quick Start

Install dependencies and create `.env` from `.env.example`:

```sh
bun run setup
```

Edit `.env` with your SupaCloud values, then install into the target SupaCloud project. SupaCloud Management API applies the hosted migrations:

```sh
bun run build
bun run install:supacloud
```

Start the local development function shim and admin console together:

```sh
bun run dev
```

The admin console runs on `http://localhost:5173/admin`. During development, Vite proxies `/api/*` to the local SupaCloud Function emulator on `http://localhost:4010/*`, so browser code still uses `VITE_AUTH_SERVER_URL=/api`. All SupAuth HTTP execution must use `packages/auth-server/src/supacloud-function.ts`; there is no standalone auth-server service.

Useful commands:

```sh
bun run dev:function # local SupaCloud Function emulator only
bun run dev:admin    # admin-console only
bun run build        # SupaCloud app manifest + Function + Pages artifacts
bun run check        # typecheck + tests + admin-console build
```

### SDK

Published npm packages for client-side integration:

```sh
# Management API client
npm install @supauth/sdk-typescript

# Supabase Auth UI adapter (React/Svelte)
npm install @supauth/sdk-auth-ui

# Shared types and claims mapping
npm install @supauth/shared
```

Management API usage:

```typescript
import { SupaOAuthClient } from "@supauth/sdk-typescript";

const client = new SupaOAuthClient({
  baseUrl: "https://auth.your-domain.com",
  accessToken: "<admin-token>",
});

// Applications
const app = await client.createApplication({
  name: "My Web App",
  type: "web",
  redirect_uris: ["https://your-app.com/callback"],
});

// Resolve per-app sign-in experience
const experience = await client.resolvePublicSignInExperience({
  application_id: app.client_id,
});

// i18n phrases
const phrases = await client.getPublicPhrases("zh-CN");
```

Auth UI bridge (React example):

```typescript
import { resolveSupabaseAuthUiConfig } from "@supauth/sdk-auth-ui";
import { Auth } from "@supabase/auth-ui-react";

const config = await resolveSupabaseAuthUiConfig({
  baseUrl: "https://auth.your-domain.com",
  applicationId: "your-app-client-id",
  locale: "zh-CN",
});

<Auth supabaseClient={supabase} {...config.auth} />
```

### Environment

Auth server (server-side only, no `VITE_` prefix):

```sh
PORT=4010
HOST=0.0.0.0
SUPACLOUD_INTERNAL_API_URL=<injected-by-supacloud>
SUPACLOUD_INTERNAL_TOKEN=<injected-by-supacloud-never-expose-to-browser>
SUPACLOUD_PROJECT_REF=<injected-by-supacloud>
SUPACLOUD_RUNTIME_URL=<injected-by-supacloud>
SUPAUTH_PUBLIC_URL=https://auth.your-domain.com
TRUST_PROXY_HEADERS=0
RUNTIME_MODE=gotrue
SUPACLOUD_DATABASE_URL=<injected-by-supacloud>
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
SUPACLOUD_STORAGE_URL=https://project-ref.supacloud.example.com
AUTH_SERVER_PROXY_TARGET=http://localhost:4010
```

## 中文

SupaOAuth 是一个部署在 SupaCloud 上的企业 IAM 和用户中心产品表面，定位接近 Logto。默认 `runtime_mode=gotrue` 下，它增强 Supabase Auth，而不是替换 Supabase Auth：OAuth/OIDC 协议 runtime、JWT 签名、refresh token、MFA、会话和 `auth.users` 仍由 GoTrue 负责；SupaOAuth 提供 hosted UI、Admin Console、组织/RBAC 治理、审计、配置和兼容性工具。

它不是 GoTrue 环境变量的轻量管理面板。

默认产品契约是“基于上游 Supabase Auth 增强”：SupaOAuth 安装后必须能运行在
SupaCloud 管理的未 fork 上游 GoTrue/Supabase Auth runtime 之上。它可以使用
GoTrue/Supabase 已文档化的扩展点、SupaCloud Management API、SupaCloud
Functions/Pages 和官方 Supabase SDK，但不能要求 SupaOAuth patched GoTrue
二进制、自定义 `/auth/v1/*` 语义，或 fork 版 `@supabase/supabase-js` / Auth UI
包。

### 架构

系统分为三层：

1. **Supabase 兼容 runtime** — GoTrue、Kong 和 Supabase API 路径负责 OIDC/OAuth 协议、JWT 签名、`auth.users` 和 RLS 兼容 claims。
2. **类似 Logto 的产品表面** — SupaOAuth 提供 Admin Console、hosted pages、SDK 和 overlay API；Applications、Users、Organizations、RBAC、Audit、Webhooks、Providers 等主数据通过 SupaCloud Management API 管理。
3. **SupaCloud 编排层** — 拥有 Management API source of truth，并负责 GoTrue env 注入、Kong 路由、实例生命周期、用户/MFA 代理、Webhook 投递和托管后台任务。

SupaOAuth 不重新实现 OIDC token 签名或 authorization code 签发。协议 runtime 由 GoTrue 负责；SupaOAuth 是 SupaCloud Function BFF、产品 overlay owner、SDK/API facade 和 runtime verifier。

完整说明见 [docs/architecture.md](docs/architecture.md)。

### Supabase 兼容性

兼容性是硬性要求。SupaOAuth 不能破坏：

- `supabase-js` auth flows
- `auth.users` 作为主身份表（gotrue mode）
- RLS 和 Supabase Auth hooks 所需的 JWT claims（`iss`、`aud`、`exp`、`iat`、`sub`、`role`、`aal`、`session_id`、`email`、`phone`、`is_anonymous`）以及需要保留的 metadata claims（`app_metadata`、`user_metadata`）
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
  sdks/auth-ui/    # Supabase Auth UI adapter (React/Svelte)
```

根目录 `src/` 是 `packages/admin-console/src/` 的轻量同步，用于保留向后兼容。

### 快速开始

安装依赖，并从 `.env.example` 创建 `.env`：

```sh
bun run setup
```

填写 `.env` 中的 SupaCloud 配置，然后安装到目标 SupaCloud 项目。迁移由 SupaCloud Management API 托管执行：

```sh
bun run build
bun run install:supacloud
```

同时启动本地开发 function shim 和 admin console：

```sh
bun run dev
```

Admin console 运行在 `http://localhost:5173/admin`。开发时 Vite 会把 `/api/*` 代理到本地 SupaCloud Function emulator `http://localhost:4010/*`，所以浏览器代码仍使用 `VITE_AUTH_SERVER_URL=/api`。所有 SupAuth HTTP 执行都必须使用 `packages/auth-server/src/supacloud-function.ts`，不再存在独立 auth-server service。

常用命令：

```sh
bun run dev:function # 只启动本地 SupaCloud Function emulator
bun run dev:admin    # 只启动 admin-console
bun run build        # 构建 SupaCloud app manifest + Function + Pages 产物
bun run check        # typecheck + tests + admin-console build
```

### SDK

已发布到 npm 的客户端集成包：

```sh
# Management API 客户端
npm install @supauth/sdk-typescript

# Supabase Auth UI 适配层（React/Svelte）
npm install @supauth/sdk-auth-ui

# 共享类型和 Claims 映射
npm install @supauth/shared
```

Management API 用法：

```typescript
import { SupaOAuthClient } from "@supauth/sdk-typescript";

const client = new SupaOAuthClient({
  baseUrl: "https://auth.your-domain.com",
  accessToken: "<admin-token>",
});

// 应用管理
const app = await client.createApplication({
  name: "My Web App",
  type: "web",
  redirect_uris: ["https://your-app.com/callback"],
});

// 按应用解析登录体验
const experience = await client.resolvePublicSignInExperience({
  application_id: app.client_id,
});

// 国际化短语
const phrases = await client.getPublicPhrases("zh-CN");
```

Auth UI 桥接（React 示例）：

```typescript
import { resolveSupabaseAuthUiConfig } from "@supauth/sdk-auth-ui";
import { Auth } from "@supabase/auth-ui-react";

const config = await resolveSupabaseAuthUiConfig({
  baseUrl: "https://auth.your-domain.com",
  applicationId: "your-app-client-id",
  locale: "zh-CN",
});

<Auth supabaseClient={supabase} {...config.auth} />
```

```

### 环境变量

Auth server（仅服务端使用，不加 `VITE_` 前缀）：

```sh
PORT=4010
HOST=0.0.0.0
SUPACLOUD_INTERNAL_API_URL=<由-supacloud-注入>
SUPACLOUD_INTERNAL_TOKEN=<由-supacloud-注入-绝不暴露到浏览器>
SUPACLOUD_PROJECT_REF=<由-supacloud-注入>
SUPACLOUD_RUNTIME_URL=<由-supacloud-注入>
SUPAUTH_PUBLIC_URL=https://auth.your-domain.com
TRUST_PROXY_HEADERS=0
RUNTIME_MODE=gotrue
SUPACLOUD_DATABASE_URL=<由-supacloud-注入>
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
SUPACLOUD_STORAGE_URL=https://project-ref.supacloud.example.com
AUTH_SERVER_PROXY_TARGET=http://localhost:4010
```
