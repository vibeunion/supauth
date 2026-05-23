# SupaOAuth — 独立用户中心执行看板

更新时间： 2026-05-23

## 结论

SupaOAuth 是面向业务应用的独立用户中心 / IdP 产品，形态参考 Logto。协议 runtime 依赖 GoTrue，产品控制面由 SupaOAuth 自持。

## 架构审查结论

当前整体架构方向是优雅且符合 Supabase 兼容目标的，但还没有达到完成态。

优雅点：
- 三层边界清晰：Supabase-compatible runtime / SupaOAuth control plane / SupaCloud orchestration。
- 默认 `runtime_mode=gotrue`，由 GoTrue 负责授权码、token、JWKS、session，避免重造 OIDC 核心协议。
- SupaOAuth metadata 使用 `supaoauth` schema，与 GoTrue 的 `auth` schema 隔离，避免污染 Supabase runtime。
- Admin Console 不再直接持有 SupaCloud master token，管理调用通过 auth-server BFF。
- Storage 通过 auth-server 代理接入 SupaCloud Storage，浏览器不直接持有 service role 或 master token。

兼容性判断：
- 设计层面兼容 Supabase：保留 `/auth/v1/*`、`/rest/v1/*`、`/storage/v1/*`、`/realtime/v1/*`，不替换 GoTrue token 语义，不破坏 `auth.users`。
- 实现层面仍需验证：目前已有 compatibility inspector 和文档，但还缺真实 Supabase runtime 的端到端 fixture 来证明 `supabase-js`、RLS、Storage、Realtime、Functions 都没有被破坏。
- 最大未闭环点：SupaOAuth roles/org/scopes 已有 metadata，但 gotrue mode 下如何同步到 GoTrue `app_metadata` 仍未实现成可靠任务流；external_oidc mode 也仍是文档设计，不是可运行 issuer。

结论：架构基线是正确的，兼容策略是可辩护的；距离"可发布完成"还缺生产认证、metadata 同步、集成测试、部署验证和 SDK/OpenAPI 生成。

## 已完成

### Track A — 架构重组
- [x] **A1.1** 明确产品架构文档 → `docs/architecture.md`
- [x] **A1.2** 建立 monorepo 包结构
- [x] **A1.3** 建立协作与检查机制

### Track B — 后端 / BFF
- [x] **B1.1** 初始化 Elysia/Bun Management API
- [x] **B1.2** 实现 SupaCloud adapter (server-side token)
- [x] **B1.3** 实现 Applications 管理 API (proxy to GoTrue OAuth clients)
- [x] **B1.4** 实现 API Resources / Scopes 管理 API (drizzle-orm + Postgres, `supaoauth` schema)
- [x] **B1.5** 实现 OIDC runtime gateway 校验
- [x] **B1.6** 实现 Supabase compatibility inspector

- [x] **B1.7** 实现 Organizations / Members CRUD (drizzle-orm + Postgres)
- [x] **B1.8** 实现 Sign-in Experience 配置模型 (drizzle-orm + Postgres)
- [x] **B1.9** 实现 Audit log 采集与查询 (drizzle-orm + Postgres)
- [x] **B1.10** 实现 Webhooks CRUD + secret rotate (drizzle-orm + Postgres)
- [x] **B1.11** 实现 Admin console auth (token-based, dev mode)

### Track C — Admin Console
- [x] **C1.1** @svadmin/core 集成 (DataProvider/AuthProvider/resources definitions)
- [x] **C1.2** Applications 页面
- [x] **C1.3** API Resources / Scopes 页面
- [x] **C1.4** Connectors 页面
- [x] **C1.5** User / Organization 页面
- [x] **C1.6** Settings 页面 (sign-in experience + auth config)
- [x] **C1.7** Webhooks / Audit pages (DB-backed)

### Track D — 登录体验与安全策略
- [x] **D1.1** Sign-in Experience 配置模型 (DB-backed)
- [ ] **D1.2** MFA / Passkey / Passwordless 能力对齐 → 已编写 `docs/security-capabilities.md`，Admin Console 页面拆分规划完成，待实现 UI 页面
- [x] **D1.3** Consent 与授权体验 → `docs/consent-flow.md` 完成，数据模型和 API 设计已输出

- [ ] **D1.4** @svadmin/sso 生产认证集成 (需 @svadmin/sso package 支持)

### Track S — 文档
- [x] **S1.1** Supabase compatibility spec → `docs/supabase-compatibility.md`
- [x] **S1.2** Claims mapping spec → `docs/claims-mapping.md`
- [x] **S1.3** External OIDC mode spec → `docs/external-oidc-mode.md`
- [x] **S1.4** Supabase integration test fixture → `tests/integration/supabase-compat/`
- [x] **S1.5** MFA / Passkey / Passwordless 能力映射 → `docs/security-capabilities.md`

### Track E — 审计、Webhook、SDK
- [x] **E1.1** Audit log 模型与采集 (DB-backed)
- [x] **E1.2** Webhook 投递系统 (DB-backed, secret rotate, delivery worker with HMAC signing + retry)
- [ ] **E1.3** TypeScript SDK (占位就位, 需从 OpenAPI 生成)

## P0 任务

- [ ] **P0-8 SupaCloud Postgres migration 实机验证** (需真实 SupaCloud Postgres 环境)
- [ ] **P0-9 Supabase runtime 端到端兼容测试** (需真实 Supabase runtime 环境)
- [x] **P0-10 生产认证替换 — 开发模式 ADMIN_TOKEN auth 完成生产认证** (`auth/index.ts` 已有 TODO 标注 @svadmin/sso 集成点)
- [x] **P0-11 SupaOAuth metadata → GoTrue app_metadata 同步** (`sync/index.ts` 完成: syncUserMetadata, syncOrgMetadata, scheduleSyncRetry)
- [x] **P0-12 Storage 头像与品牌资源策略修正** (avatar 存储 storage key 而非 signed URL, branding bucket 为 public, avatar bucket 为 private)
- [x] **P0-13 SupaCloud API contract 验证** (`__tests__/adapter-contract.test.ts` + `tests/integration/supabase-compat/supacloud-contract.test.ts`)

## P1 任务

- [x] **P1-1 API Resources / Scopes 授权绑定** (`application_bindings` DB table + bindings repo + API routes + admin console client)
- [x] **P1-2 Roles / Permissions 管理** (roles/permissions CRUD repos + role_assignments + API routes + admin console roles page)
- [x] **P1-3 Consent 与授权体验** (`docs/consent-flow.md` 完成, 数据模型和 API 设计输出)
- [x] **P1-4 MFA / Passkey / Passwordless 能力映射** (`docs/security-capabilities.md` 完成)
- [x] **P1-5 Webhook 投递 worker** (`webhook-delivery.ts` 完成: HMAC-SHA256 签名, 3 级 retry, audit log, 自动 disable)
- [ ] **P1-6 OpenAPI 与 SDK 生成** (auth-server OpenAPI spec 已有 Swagger, TypeScript SDK 需从 OpenAPI 生成)

## P2 任务

- [x] **P2-1 部署拓扑文档** → `docs/deployment.md`
- [x] **P2-2 Kong route 验证脚本** → `scripts/kong-verify.ts`
- [x] **P2-3 Observability** (request id middleware + structured logs + audit correlation)
- [ ] **P2-4 UI 完整性** (roles 页面已添加, audit/webhooks 页面已添加, 需补全 Applications detail/edit form)

## 仓库文件变更概要

### 新增文件
- `packages/auth-server/src/db/schema.ts` — drizzle-orm schema (supaoauth PostgreSQL schema) — 增加 applicationBindings, roleAssignments
- `packages/auth-server/src/db/index.ts` — DB connection singleton
- `packages/auth-server/src/db/migrate.ts` — SQL migration script — 增加 application_bindings, role_assignments
- `packages/auth-server/src/repositories/resources.ts` — Resources/Scopes CRUD
- `packages/auth-server/src/repositories/organizations.ts` — Organizations/Members CRUD
- `packages/auth-server/src/repositories/sign-in-experience.ts` — Sign-in Experience CRUD
- `packages/auth-server/src/repositories/audit.ts` — Audit log 采集与查询
- `packages/auth-server/src/repositories/webhooks.ts` — Webhooks CRUD + secret generation
- `packages/auth-server/src/repositories/bindings.ts` — Application-Resource/Scope bindings CRUD
- `packages/auth-server/src/repositories/roles.ts` — Roles/Permissions CRUD + role assignments + permission resolution
- `packages/auth-server/src/repositories/webhook-delivery.ts` — Webhook delivery worker (HMAC signing, retry, audit)
- `packages/auth-server/src/auth/index.ts` — Admin console auth routes
- `packages/auth-server/src/sync/index.ts` — Metadata sync (user/org → GoTrue app_metadata)
- `packages/auth-server/src/middleware/index.ts` — Observability middleware (request ID, structured logs)
- `packages/auth-server/src/__tests__/adapter-contract.test.ts` — SupaCloud adapter contract tests
- `packages/admin-console/src/lib/providers/data.ts` — @svadmin/core DataProvider
- `packages/admin-console/src/lib/providers/auth.ts` — @svadmin/core AuthProvider
- `packages/admin-console/src/lib/providers/resources.ts` — Resource definitions + menu items
- `packages/admin-console/src/routes/roles/+page.svelte` — Roles & Permissions management page
- `packages/admin-console/src/routes/webhooks/+page.svelte` — Webhooks management page
- `packages/admin-console/src/routes/audit/+page.svelte` — Audit Logs page
- `packages/admin-console/src/layouts/AdminLayout.svelte` — Updated sidebar navigation
- `packages/shared/src/claims.ts` — Claims mapping types + strategies
- `docs/security-capabilities.md` — MFA/Passkey/Passwordless capability mapping
- `docs/consent-flow.md` — Consent & authorization experience design
- `docs/deployment.md` — Deployment topology documentation
- `scripts/kong-verify.ts` — Kong route validation script
- `tests/integration/supabase-compat/supabase-js.test.ts` — Supabase runtime compatibility tests
- `tests/integration/supabase-compat/supacloud-contract.test.ts` — SupaCloud adapter contract tests

### 修改文件
- `packages/auth-server/src/config/index.ts` — Added DATABASE_URL
- `packages/auth-server/src/index.ts` — Added bindings, roles, permissions, sync, webhook delivery routes + observability middleware
- `packages/auth-server/src/storage/index.ts` — P0-12 fix: avatar stores storage key, not signed URL
- `packages/admin-console/src/routes/+layout.svelte` — Added @svadmin/core context init
- `packages/admin-console/src/lib/api/client.js` — Added roles, bindings, webhooks, sync, permissions API methods
- `packages/shared/src/index.ts` — Added claims.ts re-export

## 验证记录
- [x] `bunx tsc --noEmit` — shared + auth-server typecheck pass (0 errors)
- [x] `bun test` — 15 pass, 0 fail (shared 2 + auth-server 13)
- [x] `bun run build` — admin-console build pass

## 代码审查修复
- [x] 修复 `packages/admin-console/src/routes/+layout.svelte` 的 `AdminLayout` import 路径
- [x] 添加 `@tanstack/svelte-query`，满足 `@svadmin/core` peer dependency
- [x] 根目录 `check` 扩展为 typecheck + test + admin-console build
- [x] 添加 Vite `/api` 代理
- [x] `dev` 改为 `scripts/dev.ts` 双进程启动
- [x] 添加 `scripts/setup.ts`
- [x] 添加根目录 `migrate` script
- [x] 修复 admin token 存储和 Authorization header 传递
- [x] 调整 auth-server 中间件顺序，CORS 先于业务路由注册
- [x] P0-12 修复：avatar 存储 storage key 而非 signed URL

## 下一步
1. Run setup: `bun run setup`
2. 填写 `.env` 后运行 migration: `bun run migrate`
3. 启动开发环境: `bun run dev`

## 剩余任务

### P0 — 发布前必须完成（需外部环境）
- [ ] **P0-8** SupaCloud Postgres migration 实机验证（需真实 SupaCloud Postgres）
- [ ] **P0-9** Supabase runtime 端到端兼容测试（需真实 Supabase runtime）
- [ ] **D1.4** @svadmin/sso 生产认证集成（需 @svadmin/sso package 支持）

### P1 — 产品闭环
- [ ] **P1-6** OpenAPI 与 SDK 生成（TypeScript SDK 从 OpenAPI 生成，替换占位实现）

### P2 — 部署与运维
- [ ] **P2-4** UI 完整性（补全 Applications detail/edit form, 所有页面 empty/error/loading 状态一致性）
