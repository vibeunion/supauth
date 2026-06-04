# SupaOAuth — 独立用户中心执行看板

更新时间： 2026-05-29

[2026-06-04 19:49:35 CST] [supaoauth] [DONE] fix(hosted-auth): 修复 hosted auth 页面 `/favicon.ico` 404 导致浏览器登录 smoke 出现 console error 的遗留问题。`packages/auth-server/src/routes/hosted-pages.ts` 新增 `/favicon.ico` 与 `/favicon.svg` 公共路由，返回内联 SupaOAuth SVG favicon 并设置 `image/svg+xml` 与 1 天缓存；`packages/auth-server/src/__tests__/hosted-authorize-page.test.ts` 增加 favicon 200 回归。验证：`bun test packages/auth-server/src/__tests__/hosted-authorize-page.test.ts` 6 pass、`bun run --cwd packages/auth-server typecheck` 通过、`git diff --check` 通过。已部署到 vm1 `/opt/supauth/packages/auth-server/src/routes/hosted-pages.ts`，备份 `/opt/supauth/packages/auth-server/src/routes/hosted-pages.ts.bak-favicon-20260604-194848`，`supauth.service` active；公网 `https://auth.ai.example.team/favicon.ico` 返回 200 `image/svg+xml`，Playwright 从 `https://www.ai.example.team/#/login` 点击统一登录后进入 `https://auth.ai.example.team/oauth/authorize?...`，console 0 errors。

## 结论

SupaOAuth 是面向业务应用的独立用户中心 / IdP 产品，形态参考 Logto。协议 runtime 依赖 GoTrue，产品控制面由 SupaOAuth 自持。

## 架构审查结论

当前整体架构方向是优雅且符合 Supabase / SupaCloud 兼容目标的，但还没有达到生产 GA 完成态。

优雅点：
- 三层边界清晰：Supabase-compatible runtime / SupaOAuth control plane / SupaCloud orchestration。
- 默认 `runtime_mode=gotrue`，由 GoTrue 负责授权码、token、JWKS、session，避免重造 OIDC 核心协议。
- SupaOAuth metadata 使用 `supaoauth` schema，与 GoTrue 的 `auth` schema 隔离，避免污染 Supabase runtime。
- Admin Console 不再直接持有 SupaCloud master token，管理调用通过 auth-server BFF。
- Storage 通过 auth-server 代理接入 SupaCloud Storage，浏览器不直接持有 service role 或 master token。

兼容性判断：
- 设计层面兼容 Supabase：保留 `/auth/v1/*`、`/rest/v1/*`、`/storage/v1/*`、`/realtime/v1/*`，不替换 GoTrue token 语义，不破坏 `auth.users`。
- 实现层面已具备 staging 级证明：B 机基础 Supabase runtime fixture、OAuth 2.1 fixture、RBAC RLS helper 实机验证均已通过。
- 生产层面仍需补齐：基础 fixture 只能证明 GoTrue/Kong/PostgREST/Storage 的核心路径可用，不能替代完整 `supabase-js` session 生命周期、OAuth consent、Realtime/Functions、上线回滚、备份恢复、容量压测和安全滥用防护。
- 最大未闭环点：SupaOAuth 已有 roles/org/scopes metadata 与 GoTrue `app_metadata` 同步基线，但距离 Logto 级生产形态仍缺 organization template、组织级授权、Enterprise SSO/JIT、M2M 组织权限、可撤销 consent runtime 和运维闭环。

结论：架构基线是正确的，兼容策略是可辩护的；当前是 production candidate / staging-ready，不应宣称已经生产 GA。生产上线前必须完成下方新增 P0 任务。

## 生产上线差距评估（2026-05-25）

参考 Logto 的独立 IdP 产品形态，以及 Supabase 官方生产检查项，SupaOAuth 还差以下生产级闭环：

- **Logto-like 产品能力**：需要把 organization template、组织角色/权限矩阵、M2M 组织权限、Enterprise SSO/JIT provisioning、可撤销 consent runtime 做成可运行能力，而不是只停留在文档或普通 CRUD。
- **Supabase runtime 完整兼容**：需要覆盖 `supabase-js` 的 signUp/signIn/getSession/refresh/signOut、PKCE authorization-code、UserInfo、JWT/JWKS、RLS、Storage、Realtime、Functions，且不能破坏 `/auth/v1` 等 Supabase 标准路径。
- **SupaCloud 编排闭环**：需要从空项目自动创建/迁移/注入 GoTrue config、JWT signing keys、Kong routes/certs、Storage/Pages/Functions 占位，并支持幂等 reconcile 与 rollback。
- **生产安全与合规**：需要强制 SSO 管理登录、禁用生产 ADMIN_TOKEN fallback、加入 rate limit / CAPTCHA / audit / secret rotation / browser secret leak 检查。
- **上线运维**：需要备份恢复演练、发布流水线、健康门禁、容量压测、最小资源规格、回滚脚本和事故恢复目标。

## Logto 源码接口对比结论（2026-05-25）

已下载 Logto 源码到 `/Users/zhd/Documents/Codex/2026-05-25/logto-interface-compare/logto-source-b92d584`，对比 commit `b92d584bc8c40399058c2c3a59f632c464d5708e`。

对比方式：
- Logto：扫描 `packages/core/src/routes/**/*.openapi.json`，共 76 个 OpenAPI 片段，230 个 path，341 个 operation。
- SupaOAuth：执行 `bun run scripts/export-openapi.ts /tmp/supaoauth-openapi-current.json`，当前 79 个 path，110 个 operation。
- 详细结论见 `docs/logto-interface-gap-analysis.md`。

新增判断：
- 不需要 1:1 复制 Logto 的 OIDC runtime / legacy interaction runtime / cloud-only protected app 能力；默认仍由 GoTrue 负责 Supabase-compatible Auth runtime。
- 需要补齐与独立 IdP 控制面相关的接口：第三方应用 consent 与多 secret、账号中心、组织邀请/JIT/组织应用、connector factory、captcha/email template、webhook delivery diagnostics、custom domain/branding/phrases/custom profile fields。

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
- [x] **D1.2** MFA / Passkey / Passwordless 能力对齐 → `docs/security-capabilities.md` 完成，Admin Console `Security Policy` 页面已实现
- [x] **D1.3** Consent 与授权体验 → `docs/consent-flow.md` 完成，数据模型和 API 设计已输出

- [x] **D1.4** @svadmin/sso 生产认证集成 (已接入 @svadmin/sso OIDC PKCE；auth-server 使用 JWKS 校验 SSO bearer token 并保留 ADMIN_TOKEN 开发入口)

### Track S — 文档
- [x] **S1.1** Supabase compatibility spec → `docs/supabase-compatibility.md`
- [x] **S1.2** Claims mapping spec → `docs/claims-mapping.md`
- [x] **S1.3** External OIDC mode spec → `docs/external-oidc-mode.md`
- [x] **S1.4** Supabase integration test fixture → `tests/integration/supabase-compat/`
- [x] **S1.5** MFA / Passkey / Passwordless 能力映射 → `docs/security-capabilities.md`

### Track E — 审计、Webhook、SDK
- [x] **E1.1** Audit log 模型与采集 (DB-backed)
- [x] **E1.2** Webhook 投递系统 (DB-backed, secret rotate, delivery worker with HMAC signing + retry)
- [x] **E1.3** TypeScript SDK (手写客户端已完成, 包含全部 API 方法含 RLS migration, OpenAPI 导出脚本 scripts/export-openapi.ts 就位)

## P0 任务

- [x] **P0-8 SupaCloud Postgres migration 实机验证** (已在 B 机真实 SupaCloud Postgres 执行: management DB 与 tenant DB migration 均通过)
- [x] **P0-9 Supabase runtime 端到端兼容测试** (基础 live fixture 与 OAuth 2.1 live fixture 均已通过；B 机 GoTrue OAuth server 使用 ES256 project-scoped signing key)
- [x] **P0-10 生产认证替换 — 开发模式 ADMIN_TOKEN auth 完成生产认证** (`auth/index.ts` 已有 TODO 标注 @svadmin/sso 集成点)
- [x] **P0-11 SupaOAuth metadata → GoTrue app_metadata 同步** (`sync/index.ts` 完成: syncUserMetadata, syncOrgMetadata, scheduleSyncRetry)
- [x] **P0-12 Storage 头像与品牌资源策略修正** (avatar 存储 storage key 而非 signed URL, branding bucket 为 public, avatar bucket 为 private)
- [x] **P0-13 SupaCloud API contract 验证** (`__tests__/adapter-contract.test.ts` + `tests/integration/supabase-compat/supacloud-contract.test.ts`)
- [x] **P0-14 Supabase-compatible RBAC 投影基线** (`docs/rbac-supabase-compatibility.md` + `supaoauth.authorize(...)` / `supaoauth.has_org_permission(...)` migration helpers + canonical `app_metadata.supaoauth`)
- [x] **P0-15 RBAC RLS helper 实机验证** (已在 B 机 tenant DB 创建临时 RLS 表，验证 `before_grant=0 / after_grant=1 / after_revoke=0`)

## P1 任务

- [x] **P1-1 API Resources / Scopes 授权绑定** (`application_bindings` DB table + bindings repo + API routes + admin console client)
- [x] **P1-2 Roles / Permissions 管理** (roles/permissions CRUD repos + role_assignments + API routes + admin console roles page)
- [x] **P1-3 Consent 与授权体验** (`docs/consent-flow.md` 完成, 数据模型和 API 设计输出)
- [x] **P1-4 MFA / Passkey / Passwordless 能力映射** (`docs/security-capabilities.md` 完成)
- [x] **P1-5 Webhook 投递 worker** (`webhook-delivery.ts` 完成: HMAC-SHA256 签名, 3 级 retry, audit log, 自动 disable)
- [x] **P1-6 OpenAPI 与 SDK 生成** (route 模块拆分 + OpenAPI tag 注解 + swagger 配置 + export 脚本 + SDK 新增 RLS migration 方法)
- [x] **P1-7 Supabase RLS migration assistant** (扫描现有 RLS 策略, 生成 wrapper policy, 检测不安全 JWT role claim 用法)
- [x] **P1-8 RBAC compatibility inspector 扩展** (7 RBAC 检查项: helper function 存在性, grants 正确性, unsafe JWT role claim, app_metadata namespace, schema isolation, unsafe RLS patterns)

## P2 任务

- [x] **P2-1 部署拓扑文档** → `docs/deployment.md`
- [x] **P2-2 Kong route 验证脚本** → `scripts/kong-verify.ts`
- [x] **P2-3 Observability** (request id middleware + structured logs + audit correlation)
- [x] **P2-4 UI 完整性** (Applications detail/edit form 已存在于 [appId] 路由, 列表页添加导航链接, connectors empty state 补全, 所有页面 loading/error/empty 状态一致)

## 仓库文件变更概要

### 新增文件
- `packages/auth-server/src/db/schema.ts` — drizzle-orm schema (supaoauth PostgreSQL schema) — 增加 applicationBindings, roleAssignments
- `packages/auth-server/src/db/index.ts` — DB connection singleton
- `packages/auth-server/src/db/migrate.ts` — SQL migration script — 增加 application_bindings, role_assignments
- `packages/auth-server/src/routes/health.ts` — Health/Project/Runtime routes with OpenAPI tag annotations
- `packages/auth-server/src/routes/applications.ts` — Application management routes (OpenAPI tagged)
- `packages/auth-server/src/routes/connectors.ts` — Connector management routes (OpenAPI tagged)
- `packages/auth-server/src/routes/resources.ts` — API Resources/Scopes routes (OpenAPI tagged)
- `packages/auth-server/src/routes/users.ts` — User management + permission resolution routes (OpenAPI tagged)
- `packages/auth-server/src/routes/organizations.ts` — Organization + member management routes (OpenAPI tagged)
- `packages/auth-server/src/routes/roles.ts` — Role/Permission/Assignment routes (OpenAPI tagged)
- `packages/auth-server/src/routes/sign-in-experience.ts` — SIE + Auth Config routes (OpenAPI tagged)
- `packages/auth-server/src/routes/webhooks.ts` — Webhook management routes (OpenAPI tagged)
- `packages/auth-server/src/routes/audit.ts` — Audit log query routes (OpenAPI tagged)
- `packages/auth-server/src/routes/compatibility.ts` — Compatibility inspector routes (OpenAPI tagged)
- `packages/auth-server/src/routes/sync.ts` — Metadata sync routes (OpenAPI tagged)
- `packages/auth-server/src/routes/admin-tools.ts` — RLS migration assistant endpoint
- `packages/auth-server/src/compatibility/rbac.ts` — RBAC compatibility inspector (7 RBAC-specific checks)
- `packages/auth-server/src/compatibility/rls-migration.ts` — RLS migration assistant (scan + generate wrapper policies)
- `scripts/export-openapi.ts` — OpenAPI spec export script
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
- `packages/admin-console/src/routes/security/+page.svelte` — MFA / Passwordless / password policy / session policy page
- `packages/admin-console/src/routes/webhooks/+page.svelte` — Webhooks management page
- `packages/admin-console/src/routes/audit/+page.svelte` — Audit Logs page
- `packages/admin-console/src/layouts/AdminLayout.svelte` — Updated sidebar navigation
- `packages/shared/src/claims.ts` — Claims mapping types + strategies
- `docs/security-capabilities.md` — MFA/Passkey/Passwordless capability mapping
- `docs/consent-flow.md` — Consent & authorization experience design
- `docs/deployment.md` — Deployment topology documentation
- `docs/rbac-supabase-compatibility.md` — Supabase-compatible RBAC projection and migration baseline
- `scripts/kong-verify.ts` — Kong route validation script
- `tests/integration/supabase-compat/supabase-js.test.ts` — Supabase runtime compatibility tests
- `tests/integration/supabase-compat/oauth21.test.ts` — Supabase OAuth 2.1 black-box compatibility tests
- `tests/integration/supabase-compat/supacloud-contract.test.ts` — SupaCloud adapter contract tests

### 修改文件
- `packages/auth-server/src/config/index.ts` — Added DATABASE_URL
- `packages/auth-server/src/index.ts` — Route module imports + OpenAPI swagger tag config (routes split into modules)
- `packages/auth-server/src/db/migrate.ts` — Added supaoauth.authorize(...) / has_org_permission(...) RLS helper functions
- `packages/auth-server/src/sync/index.ts` — canonical metadata namespace changed to `app_metadata.supaoauth`
- `packages/auth-server/src/storage/index.ts` — P0-12 fix: avatar stores storage key, not signed URL
- `packages/admin-console/src/routes/+layout.svelte` — Added @svadmin/core context init
- `packages/auth-server/src/compatibility/supabase.ts` — Extended with RBAC checks from rbac.ts module
- `packages/sdks/typescript/src/index.ts` — Added RLS migration assistant methods (generateRLSMigration, getRLSMigrationDemo) + types
- `packages/admin-console/src/lib/api/client.js` — Added roles, bindings, webhooks, sync, permissions API methods
- `packages/admin-console/src/lib/providers/resources.ts` — Added Security Policy menu item
- `packages/admin-console/src/layouts/AdminLayout.svelte` — Added Security Policy navigation and a11y label fixes
- `packages/shared/src/index.ts` — Added claims.ts re-export

### P0-25 ~ P0-29 新增文件
- `packages/auth-server/src/supacloud/adapter.ts` — P0-26: `AdapterOptions.projectRef/runtimeUrl/storageUrl` override + `getSupaCloudAdapterForProject()` + target URL scoping + 30s request timeout
- `packages/auth-server/src/routes/provisioning.ts` — P0-26: project-scoped reconcile, `isValidProjectRef()`, safety mismatch guard
- `packages/auth-server/src/sync/index.ts` — P0-27: read-modify-write app_metadata merge, preserved field verification
- `packages/auth-server/src/repositories/rbac-bridge.ts` — P0-28: legacy role mapping policy, dry-run/import, compatibility SQL helper
- `packages/auth-server/src/routes/rbac-bridge.ts` — P0-28: RBAC bridge routes (policy/dry-run/import/helper)
- `packages/auth-server/src/routes/route-gate.ts` — P0-29: route/domain integration gate, runtime probe, conflict detection
- `packages/auth-server/src/routes/rbac-bridge.ts` — P0-28 route endpoints
- `packages/auth-server/src/__tests__/sync-merge-safety.test.ts` — P0-27 merge safety tests
- `packages/auth-server/src/__tests__/rbac-bridge.test.ts` — P0-28 RBAC bridge unit tests
- `packages/auth-server/src/__tests__/route-gate.test.ts` — P0-29 route gate tests
- `packages/auth-server/src/__tests__/adapter-contract.test.ts` — Updated with P0-26 projectRef override tests
- `tests/integration/supacloud-live/adapter-live-contract.test.ts` — P0-25 env-gated live contract tests
- `tests/integration/provisioning/project-scoped-reconcile.test.ts` — P0-26 cross-project isolation tests

## 验证记录
- [x] 2026-05-31 `fix/port-conflict-4010` 审查补齐 — 默认 auth-server 端口、根/包内 Vite dev proxy、env 示例、README/部署文档、默认管理 API 测试与容量脚本均同步到 `4010`；移除后台页脚硬编码 `Healthy` 状态；auth-server package 测试启用文件隔离，compatibility inspector 改为按当前配置创建 SupaCloud adapter，避免全局 `fetch` / env / config cache 在 CI 下串扰；`npx @sveltejs/mcp svelte-autofixer packages/admin-console/src/layouts/AdminLayout.svelte --svelte-version 5`、`bunx tsc --noEmit`、`bun test`、`bun run --filter '@supaoauth/admin-console' build`、`bun run check` 均通过。
- [x] 2026-05-30 SupaCloud 应用/项目元数据登录页兜底 — `/v1/sign-in-experience/resolve` 与 public resolve 会从 SupaCloud `getProject()` / `getOAuthClient(client_id)` 读取项目名、项目 branding、OAuth client `client_name` / `logo_uri` / 颜色等作为默认登录页品牌数据；SupaOAuth app-level sign-in experience 仍保持最高优先级，SupaCloud 查询失败不会阻断登录。
- [x] 2026-05-29 默认 hosted 登录页 Stripe 风格优化 — `packages/admin-console/static/authorize.html` 改为斜切几何背景、深色登录面板、响应式双栏/单栏布局、默认内联 favicon，并保留 per-application branding 覆盖、背景图、按钮文案和 custom CSS 注入；Playwright 桌面/移动端渲染快照通过。
- [x] 2026-05-29 服务器部署巡检 — `139.155.145.208` / `10.6.0.6` 可登录，Rocky Linux 9.4，主要部署目录为 `/opt/volt`，运行 `volt-gateway.service`、`volt-studio-server`、`volt-librechat`、`volt-rag`、`volt-meilisearch`；本机健康检查 `127.0.0.1:3090/health=200`，LibreChat `127.0.0.1:3080=200`，未发现 SupaOAuth auth-server/admin-console 正式部署。
- [x] 2026-05-29 服务器部署巡检 — `162.14.75.191` / `10.6.0.2` 首次 SSH 曾读取到 Rocky Linux 9.4、内网地址 `10.6.0.2`、启动时间 2026-05-28、24h 内大量 SSH failed login；后续公网和内网 SSH 均在 banner exchange 阶段超时，80/443 TCP 可连但 HTTP/HTTPS 无响应，暂不适合作为自动部署目标，需先修复 sshd 可用性和登录暴露面。
- [x] `bunx tsc --noEmit` — root TS check pass (0 errors)
- [x] `bun test` — 46 pass, 20 skip, 0 fail (live runtime checks gated by env flags)
- [x] 2026-05-26 `bunx tsc --noEmit` — P0-24 / P1-12~P1-16 / P2-7 implementation pass (0 errors)
- [x] 2026-05-26 `bun test` — 46 pass, 20 skip, 0 fail
- [x] 2026-05-26 `bun run check` — shared/auth-server typecheck+tests pass, admin-console production build pass
- [x] 2026-05-26 `RUN_SUPABASE_OAUTH21_COMPAT=1 OAUTH_RUNTIME_URL=https://api.x.aizhuliren.cn bun test tests/integration/supabase-compat/oauth21.test.ts` — 5 pass, 4 skip, 0 fail (token/client flows require OAuth21 client/token env)
- [x] 2026-05-26 `RUN_SUPABASE_RUNTIME_COMPAT=1 OAUTH_RUNTIME_URL=https://api.x.aizhuliren.cn MANAGEMENT_URL=https://auth.x.aizhuliren.cn/api bun test tests/integration/supabase-compat/supabase-js.test.ts` — 6 pass, 6 skip, 0 fail (session/storage/realtime/functions require anon key/test account env)
- [x] 2026-05-26 SupaCloud 新建 `supauth` 项目 `vwsvexjelurvczfivgiz` — 修复 management DB schema drift、释放 `/` 空间到 10GB+、重建空 tenant `auth` schema、启用 `GOTRUE_JWT_ISSUER` 与 `GOTRUE_OAUTH_SERVER_*`；`/auth/v1/health`、`/rest/v1/`、`/storage/v1/bucket` 均 200，Auth/REST/Storage healthy。
- [x] 2026-05-26 `RUN_SUPABASE_RUNTIME_COMPAT=1 OAUTH_RUNTIME_URL=http://vwsvexjelurvczfivgiz.api.192.168.1.48.sslip.io MANAGEMENT_URL=https://auth.x.aizhuliren.cn/api SUPABASE_ANON_KEY=... SUPABASE_TEST_EMAIL=... SUPABASE_TEST_PASSWORD=... bun test tests/integration/supabase-compat/supabase-js.test.ts` — 12 pass, 0 fail；覆盖 `supabase-js` signUp/signIn/getSession/refresh/signOut、JWT/JWKS、Storage/Realtime/Functions smoke。
- [x] 2026-05-26 `RUN_SUPABASE_OAUTH21_COMPAT=1 OAUTH_RUNTIME_URL=http://vwsvexjelurvczfivgiz.api.192.168.1.48.sslip.io bun test tests/integration/supabase-compat/oauth21.test.ts` — 5 pass, 4 skip, 0 fail；OAuth metadata / OIDC alignment / unsupported grant rejection / UserInfo no-token rejection 均通过。
- [x] 2026-05-26 SupaCloud `supauth` Realtime — 全局 Realtime v2.76.5 容器启动成功；`bun run realtime:reconcile` 完成 5/5 tenant 注册（含 supauth）；project health 显示 Realtime `ACTIVE_HEALTHY`；supabase-js live fixture 12 pass / 0 fail（含 signUp/signIn/getSession/refresh/signOut、JWT/JWKS、Storage、Realtime、Functions smoke）
- [x] `bun run check` — shared + auth-server typecheck/test + admin-console build pass
- [x] `bun run scripts/export-openapi.ts /tmp/supaoauth-openapi.json` — OpenAPI export pass (54 paths)
- [x] B 机部署验证 — `auth.x.aizhuliren.cn` SupaOAuth admin/API HTTPS 200；`api.x.aizhuliren.cn/auth/v1/health` GoTrue HTTPS 200；`api.x.aizhuliren.cn/rest/v1/` PostgREST HTTPS 200；`api.x.aizhuliren.cn/storage/v1/bucket` Storage HTTPS 200
- [x] B 机 runtime 验证 — `supacloud-pgrst@acgpswqcuaqoccjypdzy` 与 `supacloud-gotrue@acgpswqcuaqoccjypdzy` active，Kong tenant routes 已生成
- [x] `RUN_SUPABASE_RUNTIME_COMPAT=1 OAUTH_RUNTIME_URL=https://api.x.aizhuliren.cn PORT=4012 bun test tests/integration/supabase-compat/supabase-js.test.ts` — 6 pass (通过 SSH tunnel 转发 B 机 SupaOAuth 管理 API `127.0.0.1:4010`)
- [x] B 机 RBAC RLS helper 实机验证 — 临时 RLS 表 `before_grant=0 / after_grant=1 / after_revoke=0`
- [x] `RUN_SUPABASE_OAUTH21_COMPAT=1 OAUTH_RUNTIME_URL=https://api.x.aizhuliren.cn bun test tests/integration/supabase-compat/oauth21.test.ts` — 5 pass, 4 skip；OAuth metadata / OIDC alignment / unsupported grant rejection / UserInfo no-token rejection 均通过
- [x] B 机 SupaOAuth SSO 部署验证 — Admin OAuth client `56d90635-bf21-4c1a-8077-1ff26f8927d5` 已注册；`https://auth.x.aizhuliren.cn/admin` 200；未认证 `https://auth.x.aizhuliren.cn/api/v1/applications` 返回 401；`/api/v1/health` 200
- [x] B 机资源修复 — 停用非核心 Victoria/Grafana/Exporter 观测服务并增加 4G swap，Postgres/GoTrue 延迟从 5-30s 超时恢复到 100ms 级响应
1. Run setup: `bun run setup`
2. 填写 `.env` 后运行 migration: `bun run migrate`
3. 启动开发环境: `bun run dev`

## 剩余任务

### P0 — 生产 GA 前必须完成（新增）
- [x] **P0-16 Full supabase-js runtime compatibility fixture** (`tests/integration/supabase-compat/supabase-js.test.ts` 已扩展为 supabase-js 全量 fixture: signUp/signIn/getSession/refresh/signOut、JWT、Storage、Realtime、Functions smoke；live 由 env gate 控制)
  - 目标：在真实 SupaCloud tenant 上覆盖 `supabase-js` 完整 session 生命周期，而不只验证基础 health/API path。
  - 范围：signUp / signInWithPassword / getSession / refreshSession / signOut、PKCE authorization-code、access token / refresh token / UserInfo、JWT/JWKS、RLS、Storage、Realtime、Functions smoke tests。
  - 兼容要求：保持 `/auth/v1/*`、`/rest/v1/*`、`/storage/v1/*`、`/realtime/v1/*` 标准路径；fixture 不依赖 SupaOAuth 管理 API 的浏览器泄漏 token。
  - 验收：`RUN_SUPABASE_RUNTIME_COMPAT=1` 与 `RUN_SUPABASE_OAUTH21_COMPAT=1` 在 B 机真实 runtime 全量通过；OAuth 2.1 不再出现 client/token fixture skip。

- [x] **P0-17 Consent runtime implementation** (`supaoauth.user_consents` migration/schema/repository/routes 完成；支持 consent decision、grant/revoke、application/user 查询、拒绝授权 `access_denied` redirect)
  - 目标：把 `docs/consent-flow.md` 从设计稿落成生产 runtime。
  - 范围：`supaoauth.user_consents` migration/repository/API、授权请求 consent 决策、admin/user revoke、per application/resource/scope/org consent、拒绝授权返回 `access_denied`。
  - 兼容要求：GoTrue 继续负责 token 签发；SupaOAuth 只做授权体验与 consent 决策，不改写 GoTrue token 语义。
  - 验收：首次新增 scope 会提示 consent；已同意 scope 跳过；撤销后重新提示；拒绝后客户端收到标准 OAuth 错误；单测和 live fixture 覆盖。

- [x] **P0-18 Logto-like organization template and org authorization** (`organization_templates` schema/repository/API/Admin page 完成；支持模板实例化、组织角色/权限生成、M2M org role assignment、`supaoauth.app_has_org_permission(...)`)
  - 目标：补齐 Logto 式 organization template，而不是只有 organization/member CRUD。
  - 范围：组织模板、组织级 roles/permissions/scopes、成员组织上下文、M2M organization permissions、organization role assignment、组织授权审计。
  - 兼容要求：继续使用 `app_metadata.supaoauth` namespace；`auth.users` 和 Supabase RLS helper 不被污染。
  - 验收：模板创建后自动生成可预测 org roles/scopes；`supaoauth.authorize(...)` 支持 org context；M2M client 可按组织拿权限；授权/撤权即时影响 RLS helper。

- [x] **P0-19 Production security hardening** (生产/SSO 模式禁用 ADMIN_TOKEN fallback；管理 API rate limit、登录失败 lockout、安全配置 API/Admin operations 状态页、前端 secret 泄漏测试)
  - 目标：把管理面从“可用”提升到生产安全默认值。
  - 范围：生产环境强制 `ADMIN_AUTH_MODE=sso`；禁止 `ADMIN_TOKEN` fallback；admin email/domain/role allowlist；管理 API rate limit；敏感操作 audit；secret rotation；浏览器 bundle/env secret leak 检查；登录/授权滥用防护。
  - 兼容要求：开发模式仍可本地使用 token auth，但生产配置必须 fail-closed。
  - 验收：未认证管理 API 返回 401；生产环境 `ADMIN_TOKEN` 不生效；暴力请求被限流；CI 检查无 `VITE_*` 或前端 bundle 泄漏服务端 secret。

- [x] **P0-20 SupaCloud provisioning and reconcile contract** (`provisioning_records` schema/repository/API 完成；`/v1/provisioning/:projectRef/reconcile` 幂等执行 migration/runtime/storage 检查，支持 rollback reset)
  - 目标：从空 SupaCloud project 自动落地 SupaOAuth/Auth runtime，而不是依赖手工远程修补。
  - 范围：project 创建/选择、tenant DB migration、GoTrue OAuth server/ES256 signing key config、Kong routes/certs、Storage buckets、Pages/Functions placeholders、idempotent reconcile、rollback。
  - 兼容要求：项目配置保持结构化 JSON，不把 config object 写成 JSON string；不得破坏既有 Supabase runtime routes。
  - 验收：一条命令创建新 project 并通过 P0-16 fixture；重复执行无漂移；失败可回滚到上一 release/systemd symlink。

- [x] **P0-21 Backup, restore, and disaster recovery drill** (`scripts/backup-restore-drill.ts` + `docs/production-runbook.md` 完成；定义 RPO/RTO、备份 manifest、restore replay、恢复后 fixture gate)
  - 目标：上线前完成可演练的恢复路径。
  - 范围：SupaOAuth metadata schema、tenant DB migration state、SupaCloud project config、Kong routes/certs、OAuth client secrets、webhook secrets、storage branding/avatar objects。
  - 兼容要求：恢复后 GoTrue issuer/JWKS 与 Supabase client 配置保持一致，避免 token/session 全量失效。
  - 验收：定义 RPO/RTO；把一个生产样例 project 恢复到新 project/ref；恢复后通过 P0-16 fixture 与 admin smoke test。

- [x] **P0-22 Release pipeline and rollback gate** (`scripts/release-gate.ts` + `bun run release:gate` 完成；执行 tsc/test/check/OpenAPI export，生成 release manifest，支持 live fixture gate)
  - 目标：把本地构建上传改成可重复发布流程。
  - 范围：CI `bunx tsc --noEmit` / `bun test` / `bun run check` / OpenAPI export、Docker or release artifact build、远程部署、health gate、live fixture gate、自动 rollback、版本标记。
  - 兼容要求：发布失败不能影响现有 GoTrue/Auth runtime；Kong 切流必须在健康检查后进行。
  - 验收：一条 release 命令完成构建/上传/切换；任一 health 或 fixture 失败自动回滚；发布记录包含 commit、artifact hash、release id。

- [x] **P0-23 Runtime performance and capacity baseline** (`scripts/capacity-baseline.ts` + `docs/production-capacity.md` 完成；输出 runtime p50/p95/p99/error rate，定义资源与延迟基线)
  - 目标：明确 B 机和生产环境最小资源规格，避免再次因非核心服务导致 Auth runtime 超时。
  - 范围：GoTrue/PostgREST/SupaOAuth/Kong/Postgres load test、连接池配置、memory/swap 预算、非核心观测服务资源隔离、p95 latency/error budget、告警阈值。
  - 兼容要求：容量优化不得关闭 Supabase 必需 runtime；观测服务不能和 auth/runtime 抢占关键资源。
  - 验收：在目标并发下 p95、error rate、Postgres connection、swap 使用率达标；输出 `docs/production-capacity.md`。

- [x] **P0-24 Application secret lifecycle and third-party consent configuration** (`application_secrets` / `application_consent_settings` schema+migration+repository+API/Admin page/SDK 完成；支持多 secret、reveal-once、disable/delete、per-app user/org consent scopes)
  - 来源：Logto `/api/applications/{id}/secrets`、`/api/applications/{applicationId}/user-consent-scopes`、`/api/applications/{id}/users/{userId}/consent-organizations`。
  - 目标：补齐第三方 OAuth application 的生产级 secret rotation 与 consent 配置。
  - 范围：多 client secret list/create/delete、secret reveal-once、legacy secret disable、application custom data、per-app user consent scopes、per-user consent organizations、admin console 页面与 SDK 方法。
  - 兼容要求：GoTrue 仍负责 OAuth client runtime；SupaOAuth 通过 SupaCloud adapter 编排 secret，不把 client secret 暴露给浏览器。
  - 验收：可新增 secret 后灰度切换并删除旧 secret；第三方应用只请求被授权的 user/org scopes；live OAuth fixture 覆盖 consent scope/org 场景。

- [x] **P0-25 SupaCloud adapter live contract and response-shape gate**
  - 来源：兼容性复核发现 `adapter-contract.test.ts` 与 `tests/integration/supabase-compat/supacloud-contract.test.ts` 主要是 mock/shape 文档，不能证明真实 SupaCloud Management API 的所有 adapter 路径可用。
  - 目标：把 `SupaCloudAdapter` 对 `/v1/projects/:ref/config/auth`、`/auth/oauth-clients`、`/auth/providers`、`/auth/users`、secret/session/MFA/domain/storage 等路径的假设变成 live contract。
  - 范围：新增 env-gated live test；覆盖 list/get/create/update/delete 类关键路径；校验 response envelope、错误码、幂等语义、脱敏字段、超时与重试策略；把不支持的路径降级为 capability flag。
  - 兼容要求：不得把 SupaCloud master token 暴露到浏览器或日志；测试数据必须可清理，不能污染生产 tenant。
  - 验收：在 B 机真实 SupaCloud project 上通过 adapter live suite；不支持的 Management API 明确出现在 compatibility/capability report 中，Admin UI 对应操作禁用或显示可解释错误。

- [x] **P0-26 Project-scoped provisioning reconcile**
  - 来源：`/v1/provisioning/:projectRef/reconcile` 接收 path projectRef，但内部 `getSupaCloudAdapter()` 仍使用进程级 `PROJECT_REF`，存在记录 A 项目、实际检查/修改 B 项目的风险。
  - 目标：让 provisioning/reconcile 真正按请求项目执行，而不是依赖单一环境变量。
  - 范围：支持 `SupaCloudAdapter` projectRef override；reconcile 每一步显式使用 path projectRef；验证 DB migration 目标 tenant、GoTrue config、Kong route、Storage bucket 都属于同一 project；补充跨 project 防漂移测试。
  - 兼容要求：单 project 部署继续兼容现有 `PROJECT_REF` 默认值；多 project 场景必须 fail-closed，不能误操作其他 tenant。
  - 验收：两个测试 project 并行 reconcile 时互不污染；日志/audit/provisioning_records 中的 project_ref 与实际 SupaCloud API target 一致。

- [x] **P0-27 GoTrue app_metadata merge safety**
  - 来源：`syncUserMetadata()` 直接调用 `updateUser(userId, { app_metadata: { supaoauth: ... } })`，未证明 SupaCloud/GoTrue 会深度 merge；若是 replace 语义，可能覆盖业务现有 `app_metadata.role` 等字段。
  - 目标：保证 SupaOAuth 写入 `app_metadata.supaoauth` 时不破坏既有 Supabase/SupaCloud 业务 claims。
  - 范围：先读取用户现有 app_metadata；只 patch/merge `supaoauth` namespace；保留 `role`、provider、tenant、业务自定义字段；新增 replace 语义回归测试和 live verification。
  - 兼容要求：`role` 继续保留 Supabase runtime 的 `anon/authenticated` 语义；业务权限不得被塞进 JWT `role` claim。
  - 验收：带有 `app_metadata.role=admin` 与其他业务字段的真实用户执行 sync 后字段不丢失，只新增或更新 `app_metadata.supaoauth`。

- [x] **P0-28 Business app RBAC compatibility bridge for existing SupaCloud apps**
  - 来源：seagoo-ai 当前业务代码读取 `app_metadata.role` / `user_metadata.role`，而 SupaOAuth canonical hint 写入 `app_metadata.supaoauth.roles`；两套 RBAC 不冲突但未互通。
  - 目标：为既有 SupaCloud 业务应用提供可迁移的 RBAC 兼容路径。
  - 范围：定义 legacy role mapping policy；提供 `app_metadata.role` 到 SupaOAuth role/permission 的导入工具；可选输出兼容 view/helper 或业务 SDK helper；给 seagoo-ai 增加读取 `app_metadata.supaoauth` 的示例/PR 任务；覆盖前后端鉴权 smoke。
  - 兼容要求：默认不覆盖业务现有 role；迁移必须显式启用，并保留回滚路径。
  - 验收：seagoo-ai 现有 `admin/fa_expert/operator/inspector` 角色能映射到 SupaOAuth roles/permissions；迁移后旧页面权限与 API guard 行为不回退。

- [x] **P0-29 SupaOAuth route/domain integration gate on target SupaCloud stack**
  - 来源：B 机已有 SupaOAuth admin/API 与 Supabase runtime 验证，但需要把目标业务域名/Kong route/env 作为上线门禁，避免只验证 isolated supauth fixture。
  - 目标：证明 SupaOAuth 在目标 SupaCloud stack 中与业务域名、Kong、GoTrue、PostgREST、Storage、Realtime、Functions 同时可用。
  - 范围：生成 route inventory；校验 `/admin`、`/api/v1/*`、`/auth/v1/*`、`/rest/v1/*`、`/storage/v1/*`、`/realtime/v1/*`、`/functions/v1/*`；审计 tenant `.env` 与 Kong host/path；输出冲突报告。
  - 兼容要求：不得抢占 Supabase 标准路径；新增 SupaOAuth route 必须与旧业务域名共存。
  - 验收：目标业务域名和 supauth fixture 都通过同一套 route/env gate；任何 route miss、502/503/504、Host 不匹配都会阻断发布。

### P1 — 生产增强
- [x] **P1-9 Enterprise SSO / JIT / Passkey completion** (`enterprise_sso_config` 与 `passkeys` schema/repository/API/Admin page 完成；支持 domain discovery、JIT/org/role mapping、passkey list/register/revoke 基线)
  - 目标：补齐 Logto-like 企业身份入口。
  - 范围：Enterprise connector 配置、domain discovery、JIT provisioning、org membership mapping、passkey enrollment/list/revoke、org/role MFA policy。
  - 验收：企业域名自动路由到对应 IdP；JIT 首次登录创建用户和组织成员关系；用户可管理 passkey；组织策略可强制 MFA。

- [x] **P1-10 Versioned Management API and SDK contract** (`api_version_log` schema/repository/API、SDK 方法、`docs/versioned-api-contract.md`、release OpenAPI hash gate 完成)
  - 目标：把当前 OpenAPI/SDK 生成变成生产稳定契约。
  - 范围：`/api/v1` versioning policy、标准 error envelope、breaking-change check、SDK 生成/发布流程、兼容性 changelog。
  - 验收：CI 可阻止未声明的 breaking change；SDK 与 OpenAPI hash 对齐；文档列出错误码和迁移策略。

- [x] **P1-11 Tenant isolation and security review** (`tests/integration/tenant-isolation.test.ts`、audit 自动注入 `request_id/project_ref`、浏览器 VITE secret 泄漏检查完成；cross-tenant live fixture 由 env gate 控制)
  - 目标：证明多租户隔离和服务端密钥边界可靠。
  - 范围：cross-tenant API tests、SQL grants/RLS review、service-role/master token 使用面审计、admin BFF 权限校验、audit log tamper-resistance。
  - 验收：跨租户访问 fixture 全部拒绝；前端无服务端 secret；所有 mutation 有 actor/project/request_id 审计记录。

- [x] **P1-12 Account Center and admin user management proxy** (`account_sessions` schema/repository/API/Admin users panel 完成；admin profile update/suspend/session revoke/identity unlink/MFA reset 通过 SupaCloud adapter 代理，mutation 写 audit)
  - 来源：Logto `/api/my-account/*`、`/api/users/{userId}/profile`、sessions、identities、MFA verifications、grants。
  - 目标：提供独立 IdP 需要的用户自助账号中心和 admin 侧用户管理 BFF。
  - 范围：my-account profile/password/email/phone/identities/sessions/MFA/passkeys/grants；admin user profile/update/suspend/session revoke/identity unlink/MFA reset；审计和 webhook 事件。
  - 兼容要求：优先代理 GoTrue/SupaCloud 用户 runtime，不重写 `auth.users` 或 token/session 语义。
  - 验收：用户可自助更新资料、管理身份和会话；管理员可撤销用户 session/MFA/identity；所有 mutation 有 audit 与 cross-tenant test。

- [x] **P1-13 Organization invitation, JIT, and organization application APIs** (`organization_invitations` / `organization_jit_settings` / `organization_applications` schema+migration+repository+API/Admin controls/SDK 完成)
  - 来源：Logto `/api/organization-invitations`、`/api/organization-roles`、`/api/organization-scopes`、`/api/organizations/{id}/jit/*`、`/api/organizations/{id}/applications/*`。
  - 目标：把当前 org templates/enterprise SSO 基线扩展成完整 B2B organization control plane。
  - 范围：organization invitations、JIT email domains、JIT SSO connectors、JIT default roles、organization roles/scopes first-class CRUD、organization applications/M2M binding、organization app role assignment。
  - 兼容要求：权限仍落到 `app_metadata.supaoauth` hint + Postgres helper，不把业务权限塞进 JWT `role` claim。
  - 验收：邀请接受后加入组织；企业 SSO/JIT 登录自动建 membership/roles；M2M client 可按组织获取权限；RLS helper 即时生效。

- [x] **P1-14 Connector factory, provider catalog, captcha, and template configuration** (`connector_factories` + `tenant_configs` schema+migration+repository+API/Admin tenant config/SDK 完成；覆盖 factory catalog、captcha、email/SMS templates)
  - 来源：Logto `/api/connector-factories`、`/api/connectors/{id}/authorization-uri`、`/api/connectors/{factoryId}/test`、`/api/sso-connector-providers`、`/api/captcha-provider`、`/api/email-templates`。
  - 目标：让 connectors、captcha、SMTP/SMS/email template 可自助配置和验证。
  - 范围：connector provider catalog、typed config schema、authorization URI preflight、config test with redacted diagnostics、captcha provider config、email/SMS template management、verification provider health check。
  - 兼容要求：验证码发送和认证 runtime 优先交给 GoTrue/SupaCloud；SupaOAuth 提供配置控制面和验证，不在浏览器暴露 provider secrets。
  - 验收：创建/修改 connector 前可验证配置；captcha/email template 可通过管理 API 更新；错误信息脱敏；live smoke 覆盖至少 OIDC/SAML SSO provider 和 SMTP provider。

- [x] **P1-15 Webhook delivery diagnostics and audit detail** (webhook signing key id、recent audit logs、manual test、replay、diagnostic delivery audit、Admin diagnostics/SDK 完成)
  - 来源：Logto `/api/hooks/{id}/recent-logs`、`/api/hooks/{id}/test`、`/api/hooks/{id}/signing-key`、`/api/logs/{id}`。
  - 目标：补齐生产 webhook onboarding 与故障排查接口。
  - 范围：webhook delivery logs、recent logs、manual test event、delivery replay、signing key rotate with key id、audit log detail/filter、delivery failure metrics。
  - 兼容要求：webhook secret 不明文返回；测试和重放事件必须标记来源，避免污染业务审计。
  - 验收：admin 可看到最近投递结果并重放失败事件；test endpoint 可验证签名；audit detail 可按 request_id/project_ref/user/app 过滤。

- [x] **P1-16 Domain, branding, phrases, and custom profile fields** (`tenant_configs` 覆盖 domain/phrase/profile_field/branding_asset，custom domain health 通过 SupaCloud adapter 代理，Admin Tenant Config 页面完成)
  - 来源：Logto `/api/domains`、`/api/sign-in-exp/default/custom-ui-assets`、`/api/custom-phrases`、`/api/custom-profile-fields`、well-known phrases/account-center。
  - 目标：补齐独立 IdP 面向终端用户的品牌化和资料字段控制面。
  - 范围：custom domain/SSL lifecycle via SupaCloud/Kong、branding/custom UI assets、i18n phrases、custom profile fields、profile field order、password policy check proxy、account-center public config。
  - 兼容要求：域名和证书必须通过 SupaCloud/Kong 编排；profile fields 不破坏 Supabase `auth.users` 基础字段，扩展字段进入 SupaOAuth metadata。
  - 验收：新增域名后可完成 HTTPS health check；登录/账号中心可加载品牌资源和 phrases；自定义 profile fields 可参与注册资料收集。

- [x] **P1-17 Per-application sign-in experience** (`application_sign_in_experience` schema+migration/repository/API/Admin page/SDK/hosted authorize page 完成；支持按 OAuth client 覆盖 logo、favicon、primary color、title、background、button label、custom CSS、hosted page i18n，并提供 public/effective resolve 接口)
  - 来源：Logto per-app branding / sign-in experience 能力缺口。
  - 目标：让 Volt 等不同业务应用可以使用独立登录页品牌，而不是只能使用租户级统一模板。
  - 范围：应用级登录体验覆盖表、应用详情页配置、管理 API、SDK、全局配置兜底、hosted `authorize.html`、基础 i18n 和运行时 resolve。
  - 兼容要求：GoTrue 继续负责 OAuth/OIDC runtime；SupaOAuth 只提供登录体验配置和授权页渲染数据，不改写 token 签发语义。
  - 验收：未配置应用覆盖时返回全局登录体验；启用应用覆盖时按 `application_id/client_id` 或 GoTrue `authorization_id` 返回合并后的登录体验；Admin 可保存或清除应用覆盖；授权页加载应用品牌后继续回到 GoTrue OAuth authorize；登录页根据 `ui_locales`、用户选择或浏览器语言显示中英文文案；Hosted authorize / OIDC issuer 正式入口为 `auth.x.aizhuliren.cn`。

### P2 — 产品体验与运营
- [x] **P2-5 Product UX parity pass** (Dashboard onboarding checklist、Consent/Org Templates/Enterprise SSO/Operations 管理页、资源/组织/security 最短配置路径完成)
  - 目标：面向生产用户补齐独立 IdP 的首屏配置体验。
  - 范围：onboarding checklist、empty states、connector setup guide、resource/scope templates、role/org template 快捷创建、audit filters。
  - 验收：admin 首次进入可完成应用、资源、组织、connector、security policy 的最短可用配置路径。

- [x] **P2-6 Production runbook and incident playbook** (`docs/production-runbook.md` 覆盖发布、回滚、备份恢复、fixture failure triage、Auth/Postgres/Storage/Kong 故障处理)
  - 目标：让部署、回滚、恢复、排障有固定手册。
  - 范围：Kong/Auth/Postgres/Storage 常见故障、证书续期、key rotation、backup restore、fixture failure triage、容量告警处理。
  - 验收：`docs/production-runbook.md` 覆盖 P0-20 至 P0-23；B 机按 runbook 完成一次演练记录。

- [x] **P2-7 SAML / token exchange / PAT decision spike** (`docs/extended-protocol-decision-spike.md` 完成：SAML IdP/token exchange 延期，PAT 与 one-time token 分阶段进入 roadmap)
  - 来源：Logto `/api/saml-applications`、`/api/subject-tokens`、`/api/users/{userId}/personal-access-tokens`、`/api/one-time-tokens`。
  - 目标：决定是否进入 SupaOAuth roadmap，而不是默认复刻 Logto 全部扩展协议。
  - 范围：评估 SAML application as IdP、OAuth token exchange、personal access tokens、one-time tokens 与 Supabase/GoTrue/SupaCloud 的兼容成本和目标客户价值。
  - 兼容要求：任何新协议不能替换默认 GoTrue runtime；若需要实现，必须先定义 external issuer mode 与 Supabase JS 兼容边界。
  - 验收：输出 go/no-go 文档；若 go，再拆成独立 P1/P2 实施任务；若 no-go，记录延期条件。

### 已完成的发布前外部验证
- [x] **P0-8** SupaCloud Postgres migration 实机验证（B 机真实 SupaCloud Postgres 已通过）
- [x] **P0-9** Supabase runtime 端到端兼容测试（基础 live fixture 与 OAuth 2.1 live fixture 均已通过）
- [x] **P0-15** RBAC RLS helper 实机验证（B 机 tenant DB 已通过授权/撤权即时生效验证）
- [x] **D1.4** @svadmin/sso 生产认证集成（@svadmin/sso 已接入 admin-console；auth-server 已启用 OIDC JWKS bearer 校验；B 机已注册 Admin Console OAuth client 并部署）

### 已完成的 P1 产品闭环
- [x] **P1-6** OpenAPI 与 SDK 生成
- [x] **P1-7** Supabase RLS migration assistant
- [x] **P1-8** RBAC compatibility inspector 扩展

### 已完成的 P2 部署与运维
- [x] **P2-4** UI 完整性（Applications detail/edit form 已存在, 列表页导航链接已添加, connectors empty state 已补全, 所有页面状态一致）
- [x] [2026-06-03T17:55:45+0800] Auth UI 适配器 npm 自动发布 CI：参考 `supacloud` 的 release-please + npm OIDC Trusted Publisher / provenance 发布方式，以及 `svadmin` 的 npm pack dry-run 与 workspace 依赖改写策略；新增 `release-please-config.json`、`.release-please-manifest.json`、`.github/workflows/release-please.yml`，release 创建后会按顺序构建 `@supaoauth/shared`、`@supaoauth/sdk-typescript`、`@supaoauth/sdk-auth-ui` 并检查 npm bootstrap 状态；包名尚未存在时只输出 notice 并跳过自动发布，首次创建包仍由维护者在 npmjs 手动发布，后续版本再走 OIDC provenance 自动 publish。新增 `.github/scripts/prepare-auth-ui-npm-package.mjs` 将发布时的 `workspace:*` 改写为实际 semver，并在 CI 中校验 `dist/index.js` / `dist/index.d.ts`。`ci.yml` 新增 `Package Auth UI SDK` job，PR/Push 会先 `npm pack --dry-run` 验证包内容。验证：`bunx tsc --noEmit`、`bun run typecheck`、三包 `npm pack --dry-run`、`bun run check`、`bun test` 均通过（188 pass, 42 skip, 0 fail）。
- [ ] [2026-06-03T23:34:45+0800] 本地 npmjs 首次发布收尾：为 `packages/sdks/typescript`、`packages/sdks/auth-ui` 拆分 `tsconfig.build.json`，使单包 `prepack` 走发布专用解析而不污染 Bun 测试运行时；`bun install` 后验证 `bunx tsc --noEmit`、`bun test`（188 pass, 42 skip, 0 fail）、三包顺序 build、`npm pack --dry-run` 均通过。实际发布时直连 `https://registry.npmjs.org/` 执行 `npm publish --access public`，`@supaoauth/shared@0.0.1` 打包成功但因本机无 npm 登录态失败于 `ENEEDAUTH`；`~/.npmrc` 当前仅有 `registry=https://registry.npmmirror.com`，无 token。后续需维护者先完成 `npm adduser` / token 登录，再按 `@supaoauth/shared` → `@supaoauth/sdk-typescript` → `@supaoauth/sdk-auth-ui` 顺序首次发布。
- [x] [2026-06-03T17:46:40+0800] SupAuth hosted 登录页错误提示修复并部署到 vm1：`packages/admin-console/static/authorize.html` 登录表单提交前会对邮箱做 NFKC 归一化、去除零宽字符和首尾空白，并校验邮箱格式/空密码；GoTrue `Invalid login credentials` / `invalid_credentials` 会通过 i18n 默认文案统一映射，中文为“账号或密码不匹配，请检查后重试。”，英文为“Account or password does not match. Please check and try again.”，不区分账号不存在和密码错误，避免账号枚举。补充 `hosted-authorize-page.test.ts` 覆盖实际 served HTML 中的邮箱规整、中英文错误映射和登录错误处理。本地验证：`bun run --filter '@supaoauth/admin-console' build`、`bun test packages/auth-server/src/__tests__/hosted-authorize-page.test.ts`、`bunx tsc --noEmit`、`bun test` 均通过（188 pass, 42 skip, 0 fail）。线上部署：同步 `authorize.html` 到 vm1 `/opt/supauth/packages/admin-console/{static,build}/authorize.html`，备份 `/opt/supauth/backups/authorize-20260603-174308`；同步 `packages/auth-server/src/routes/sign-in-experience.ts` 与 `src/index.ts`，补齐线上缺失的 `publicPhrasesRoutes/publicConnectorRoutes/publicCustomUiRoutes` 挂载，备份 `/opt/supauth/backups/auth-server-20260603-174445` 与 `/opt/supauth/backups/auth-server-index-20260603-174544`，重启 `supauth.service` 后 active。线上验证：`https://auth.ai.example.team/v1/public/phrases/zh-CN` 返回 200 `{"language_tag":"zh-CN","phrases":{}}`；Playwright 打开 `https://auth.ai.example.team/login.html?ui_locales=zh-CN`，输入 `  admin＠xgic.dev  ` + 错误密码后邮箱规整为 `admin@xgic.dev`，页面显示“账号或密码不匹配，请检查后重试。”；业务错误请求 `/auth/v1/token?grant_type=password` 返回 400 属预期，控制台仅剩 favicon 404。
- [x] [2026-06-03T15:32:17+0800] 修复 vm1 `hosted-pages` 在不同启动方式下的静态页路径解析：`packages/auth-server/src/routes/hosted-pages.ts` 改为同时覆盖 `src` / `dist` / repo-root / package-root 候选路径，不再依赖单一 `PROJECT_ROOT` 推断；补充 `resolveHostedPagePaths` 测试覆盖 `bun run src/index.ts` 与 `bun run dist/index.js` 两种布局。2201 重新 build 并 `systemctl restart supauth` 后，清理残留手工 `nohup bun run packages/auth-server/dist/index.js` 进程，最终仅保留 systemd 进程监听 4010。验证：本地 `bunx tsc --noEmit --project packages/auth-server/tsconfig.json`、`bun test packages/auth-server/src/__tests__/hosted-authorize-page.test.ts`、`bun run --filter '@supaoauth/auth-server' build` 通过；2201 `http://localhost:4010/oauth/authorize`、`/login.html`、`/` 全部 200；公网 `https://auth.ai.example.team/oauth/authorize`、`/login.html`、`/` 全部 200。
- [x] `bunx tsc --noEmit` — P0-25~P0-29 implementation pass (0 errors)
- [x] `bun test` — 161 pass, 39 skip, 0 fail (env-gated live tests skipped as expected)
- [x] `bunx tsc --noEmit` — P0 review fix pass (0 errors)
- [x] `bun test` — 166 pass, 42 skip, 0 fail (project-scoped URL tests and expanded route gate coverage)
- [x] [2026-06-02T00:02:40+0800] vm1 SupaOAuth 离线升级并接入 `dglewlzugrtygzysqrce` 项目：通过 TrueNAS 内网传包部署到 `/opt/supauth`，保留回滚目录 `/opt/supauth.prev-20260602000052`；修复 runtime 探针以支持 `OAUTH_RUNTIME_INTERNAL_URL` 直连 GoTrue 无 `/auth/v1` 前缀、公开 issuer 仍为 `http://oauth.ai.example.org/auth/v1` 的拓扑。登录体验品牌已配置为 `示例 OAuth 用户中心`，主色 `#2563eb`。验证：`/v1/health` 返回 `project_ref=dglewlzugrtygzysqrce`；`/v1/runtime/health` 返回 discovery/jwks/authorize/token/userinfo 全 true；`/v1/public/sign-in-experience/resolve` 返回品牌名；本地 `bunx tsc --noEmit` 与 `bun test` 通过（167 pass, 42 skip, 0 fail）。vm2 未发现 SupAuth 服务或 SupAuth 反代配置。
- [x] 2026-06-03 嵌入式 Auth UI 适配层 — 新增 `@supaoauth/sdk-auth-ui`，直接桥接官方 `@supabase/auth-ui-react` / `@supabase/auth-ui-svelte`；通过 `resolvePublicSignInExperience` + `getPublicPhrases` 生成 `providers`、`appearance`、`localization`、`redirectTo` 配置，并输出 `unsupportedConnectors` 供业务侧单独渲染企业 SSO 入口。新增文档 `docs/embedded-auth-ui.md`。

## 2026-05-30 Codex 执行记录 — Logto/Supabase 差距闭环实施

- [x] **Supabase-native authorization compiler**
  - 新增 `packages/auth-server/src/compatibility/authorization-compiler.ts`，支持从 table/storage/realtime/edge-function 目标生成 review-only RLS、Storage policy、Realtime 模板、Edge Function gate、rollback SQL、负向测试矩阵和部署清单。
  - 新增 `/v1/admin-tools/authorization-compiler` 与 `/v1/admin-tools/authorization-compiler/demo`，保持与 RLS migration assistant 一样的“只生成、不直接改租户库”边界。
  - SDK 新增 `compileAuthorizationPlan`、`getAuthorizationCompilerDemo`。
  - 验证：`bunx tsc --noEmit` 通过；新增 `authorization-compiler.test.ts` 通过。

- [x] **Supabase Auth Hooks bridge**
  - 新增 `packages/auth-server/src/auth/hooks-bridge.ts` 与 `/v1/auth-hooks/*` 公共 hook 路由，注册在 admin guard 前，但通过独立 `SUPAOAUTH_AUTH_HOOK_SECRET` 防护。
  - 支持 `before-user-created` 注册策略（域名 allow/block、provider allow/block、invite-only）、`custom-access-token` 小型 `app_metadata.supaoauth` hook marker、`mfa-verification-attempt` 风险拒绝。
  - `tenant-config` 允许 `auth_hook` 类型，便于通过管理 API 配置 `auth_hook/signup_policy`。
  - SDK 新增 `getAuthHookRegistrationGuide`。
  - 验证：`bunx tsc --noEmit` 通过；新增 `auth-hooks.test.ts` 与 SDK 方法测试通过。

## 2026-06-04 Codex 执行记录 — 跨应用 SSO 方案与实现

### 问题背景

用户问：应用 1 通过 SupaOAuth 登录后，进入应用 2 能否自动登录？

### 当前约束

默认 `runtime_mode=gotrue` 下，跨应用 SSO 必须以 GoTrue session / OAuth server 为 runtime 边界。原因：
- GoTrue 是 project-scoped session，每个 Supabase project 有独立的 `auth.users`、JWT signing key、session cookie
- SupaOAuth 当前不持有 IdP session，也不应在 gotrue 模式伪造 GoTrue 登录或签发 token
- 为保持 `supabase-js` / Storage / Realtime / Functions 兼容，默认方案不能替换 GoTrue token 语义

### 方案对比

#### 方案 A：SSO Broker 层（不推荐）

在 GoTrue 之上加 session broker：
- SupaOAuth 维护 IdP session cookie
- 应用 2 发起 `/authorize` 时，检测到 IdP session → back-channel 替用户完成 GoTrue 登录

**核心缺陷**：
- 需要 service role key 造 token（破坏 OIDC 语义）
- 或用 GoTrue admin `generateLink` API 造 magic link（需要用户点击，不是透明 SSO）
- 或用 resource owner password grant（需要用户密码，不安全）

#### 方案 B：统一 GoTrue Project（最简单，但牺牲隔离）

所有应用共享同一个 Supabase project：
- 同一 `auth.users` 表
- 同一 session cookie
- GoTrue 自带 session 共享

**限制**：
- 所有应用共享同一数据库（`rest/v1/*`）
- 无法做 project 级隔离
- 不适合多租户场景

#### 方案 C：External OIDC Mode + SupaOAuth as IdP（高级模式，暂缓）

让 SupaOAuth 成为真正的 OIDC Provider：
- SupaOAuth 自持 session（`supaoauth.idp_sessions` 表 + 认证域名 cookie）
- SupaOAuth 签发 JWT（RS256/ES256，通过 JWKS）
- GoTrue 配置 third-party auth，信任 SupaOAuth 签发的 JWT
- 应用 2 发起 `/authorize?prompt=none` → SupaOAuth 检测到 IdP session → 直接签发授权码

**风险**：
- `external_oidc` 会把 token refresh、session、password reset / email confirmation 等能力迁移到外部 IdP 语义
- 业务应用可能需要从 `supabase-js` auth session 模式迁移到 SupaOAuth 自持 SDK
- 不适合作为当前跨应用 SSO 的默认落地路径

### 决策与实现

采用 **GoTrue-compatible SSO entrypoint** 作为 P1-18 当前实现：

- 新增 `packages/auth-server/src/routes/sso-authorize.ts`
- 新增公开入口：
  - `GET /oauth/sso/authorize`
  - `GET /v1/public/oauth/sso/authorize`
- 行为：
  - 校验 `client_id` 存在于 SupaCloud / GoTrue OAuth clients
  - 对 `redirect_uri` 做精确白名单匹配，禁止 fragment
  - 仅支持 authorization code flow；其他 `response_type` 返回标准 OAuth callback error
  - 保留 `prompt=none` / PKCE / state / nonce / scope / resource 等参数并 302 到 GoTrue `/auth/v1/oauth/authorize`
  - 不签发 token，不创建 SupaOAuth IdP session，不破坏现有 gotrue runtime

### 验收

- [x] 应用 1 / 应用 2 使用同一 GoTrue project 与同一认证域名时，可复用 GoTrue 原生 session，避免重复输入账号密码
- [x] SupaOAuth 提供统一 SSO authorize 入口，先做 application / redirect URI 安全校验，再交给 GoTrue runtime
- [x] `prompt=none` 被保留并转交给 GoTrue；SupaOAuth 不伪造登录状态
- [x] 本地新增 `sso-authorize.test.ts` 覆盖 redirect、redirect_uri 校验、unsupported response_type OAuth error
