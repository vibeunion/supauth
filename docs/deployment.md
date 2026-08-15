# Deployment Topology

> SupaOAuth task P2-1

## 架构总览

SupAuth **所有 HTTP 运行形态都必须由 SupaCloud Function 托管调用**。
不得再部署独立 `supauth.service` / systemd / pm2 常驻进程；本地
`localhost:4010` 也只能是 SupaCloud Function emulator，不是 auth-server service。

```
┌─────────────────────────────────────────────────────────────┐
│                        Kong Gateway                         │
│  :8000 / :8443                                              │
├──────────┬──────────┬──────────┬──────────┬────────────────┤
│ /admin/* │ /api/*   │/auth/v1/*│/storage  │ /rest/v1/*     │
│          │          │          │  /v1/*   │                │
└────┬─────┴────┬─────┴────┬─────┴────┬─────┴────┬───────────┘
     │          │          │          │          │
     ▼          ▼          ▼          ▼          ▼
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│ Admin   │ │SupAuth  │ │ GoTrue  │ │ Storage │ │ PostgREST│
│ Console │ │Function │ │ (OIDC) │ │ API     │ │          │
│ Pages   │ │(BFF)    │ │         │ │         │ │          │
│         │ │         │ │         │ │         │ │          │
└─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘
     │          │                       │          │
     │          └───────┬───────────────┘          │
     │                  │                          │
     ▼                  ▼                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    PostgreSQL (SupaCloud)                    │
│  auth.* (GoTrue)    supaoauth.* (SupaOAuth)                 │
└─────────────────────────────────────────────────────────────┘
```

## 域名与路径映射

当前西谷中央 SupAuth 正式身份项目是 `vwsvexjelurvczfivgiz`，`dglewlzugrtygzysqrce` 是独立业务应用项目，不是 SupAuth 正式项目。SupAuth Function、账号领取、中央身份配置和线上验收默认以 `vwsvexjelurvczfivgiz` 为目标；业务数据和业务 Function 仍留在其所属项目。操作前先按 `docs/live-projects.md` 确认边界。

| 服务 | 路径 | 说明 |
|------|------|------|
| Admin Console | `/admin` | SvelteKit SPA，作为 `admin-console/build/**` 随 SupAuth 多文件 Function bundle 发布 |
| SupAuth Function (BFF) | `/api/v1/*`, `/v1/public/*`, `/oauth/sso/authorize` | SupaCloud Function 调用 `supacloud-function.ts` |
| GoTrue (runtime) | `/auth/v1/*` | OIDC 端点，SupaOAuth 不替代 |
| Storage | `/storage/v1/*` | 文件存储，SupAuth Function 代理敏感操作 |
| PostgREST | `/rest/v1/*` | 数据 API，不与 SupaOAuth 冲突 |
| Realtime | `/realtime/v1/*` | WebSocket，不与 SupaOAuth 冲突 |
| JWKS | `/auth/v1/.well-known/jwks.json` | GoTrue 签发，SupaOAuth 只读取 |
| Discovery | `/auth/v1/.well-known/openid-configuration` | GoTrue 提供，SupaOAuth 只读取 |

## SupaOAuth SupaCloud Function (BFF)

- **技术栈**：Elysia handler + SupaCloud Functions + drizzle-orm + postgres.js
- **生产入口**：`packages/auth-server/src/supacloud-function.ts`
- **本地开发端口**：4010，仅 `bun run dev:function` 的 Function emulator 使用
- **环境变量**：见 `.env.example`
- **数据库**：共享 SupaCloud 的 Postgres 实例，使用 `supaoauth` schema
- **认证**：开发模式先用原始 `ADMIN_TOKEN` 调用 `POST /api/v1/auth/login` 换取管理 session token；生产模式用 `@svadmin/sso` access token。原始 `ADMIN_TOKEN` 不能直接作为管理 API Bearer token

### 部署步骤

1. 构建 SupaCloud app artifact：`bun run build`
2. SupaCloud 读取 `artifacts/supacloud-app/supacloud-app-manifest.json`
3. SupaCloud 注入 `SUPACLOUD_INTERNAL_API_URL`、`SUPACLOUD_INTERNAL_TOKEN`、`SUPABASE_SERVICE_ROLE_KEY`、`SUPAOAUTH_BFF_SIGNING_SECRET`、`SUPACLOUD_PROJECT_REF`、`SUPACLOUD_RUNTIME_URL` 和 `SUPACLOUD_DATABASE_URL`。其中 internal token 仅用于 Management API，service-role key 仅用于项目 Storage。安装器将 SupAuth 的逻辑变量（例如 `SUPAUTH_PUBLIC_URL`、`ADMIN_SSO_ISSUER`、`ADMIN_SSO_CLIENT_ID`）写入 `supauth` Function 专属 secrets，平台以 `EDGEFN_SUPAUTH_<逻辑变量>` 注入；管理员 MFA 门禁仅在逻辑值显式为 `ADMIN_SSO_REQUIRE_AAL2=true` 时开启
4. 安装器按 manifest 的 V1/V4/V5/V6/V7/V8/V9/V10 顺序，通过 SupaCloud Management API
   对 `SUPACLOUD_DATABASE_URL` 应用幂等 hosted migrations；禁止绕过安装器直连
   执行迁移。V9 独立撤销旧 webhook 表的 Function/PUBLIC 权限，V10 仅在
   两张旧表均为空时按 deliveries → definitions 顺序删除它们
5. 将 `packages/auth-server/dist/supacloud-function/supacloud-function.js` 作为 `index.ts`，并将 `packages/admin-console/build` 的全部 regular UTF-8 text 文件稳定排序后发布到同一 Function bundle 的 `admin-console/build/**`；symlink、特殊文件、NUL/binary、无效 UTF-8 或越界路径必须阻断发布
6. 按 manifest 将 `/api/*`（strip `/api`）、`/v1/public/*`、`/oauth/*`、`/login`、`/login.html`、`/authorize.html`、`/claim`、`/claim.html` 和 `/admin/*` 路由到 Function
7. 按 manifest 的 `authority`、`gotrue_owned_runtime_domains`、
   `supacloud_owned_management_domains` 与 `supacloud_management_facades`
   检查数据权威：GoTrue 拥有用户、Identity、OAuth Grants、Session、Refresh
   Token、MFA、JWT/JWKS；SupaCloud 拥有 Applications 控制面、业务组织、
   RBAC、协作者、Audit、Webhooks 与 Secret Manager；SupAuth Function 只做
   BFF/facade 和 overlay。
8. 按 manifest 的 `supacloud_managed_background_jobs` 确认 webhook 投递、重试、诊断和失败禁用由 SupaCloud 托管任务执行；SupAuth 不部署 webhook worker、cron 或 systemd/pm2 进程。
9. 安装完成后运行 live verifier：
    `SUPAUTH_PUBLIC_URL=https://auth.example.com SUPAUTH_INSTALLED_RUNTIME_URL=https://project.example.com bun run scripts/verify-supacloud-installed-app.ts --artifact-dir artifacts/supacloud-app`

### 旧 Webhook 表退役

升级前必须通过受控备份保存 `supaoauth.webhooks` 与
`supaoauth.webhook_deliveries`，但不得把其中的 secret 写入终端、CI 日志或
普通迁移报告。V10 发现任一表非空时会以
`reason_code=legacy_webhook_data_present` 阻断安装并给出恢复提示，不会删除
定义、投递记录或 secret。

阻断后，在 SupaCloud Webhooks 中重建定义，让签名 secret 只写入 SupaCloud
Secret Manager；接收端完成新 `X-SupaCloud-*` 签名协议和密钥轮换，并通过
测试投递后，才能清空已备份的旧记录并重新安装。旧 pending delivery 不做
自动重放，因为旧 `X-SupaOAuth-*` 签名格式与 SupaCloud v1 不兼容。安装成功
必须由数据库验证确认两张旧表都不存在。

`SUPAUTH_PUBLIC_URL` 是浏览器可见的 SupAuth/Auth 自定义域名，OAuth/SSO 跳转会优先使用它；在 SupaCloud Function 中应由安装器写为 `EDGEFN_SUPAUTH_SUPAUTH_PUBLIC_URL`，不得尝试写入保留的项目级 `SUPAUTH_PUBLIC_URL`。`SUPACLOUD_RUNTIME_URL` 只用于 GoTrue/Supabase runtime 内部或保留路径探测。仅在反向代理会清洗并独占 `X-Forwarded-*` 请求头时，才设置 `TRUST_PROXY_HEADERS=1`。

`RUNTIME_MODE` 省略时等同于 `gotrue`，显式值也只能是 `gotrue`。安装器
或 Function 发现其他值必须立即失败，不允许发布一个独立 issuer、独立
discovery/JWKS 或第二套 Session/MFA 的半实现运行时。

`SUPAOAUTH_BFF_SIGNING_SECRET` 必须是独立、随机且至少 32 个字符的服务端 secret。SupaCloud Management API 与 SupAuth Function 必须使用同一个值；它不得与 `SUPACLOUD_INTERNAL_TOKEN`、master token 或加密密钥复用，浏览器和任何 `VITE_*` 变量都不可见。安装器通过 `--bff-signing-secret` 或同名环境变量接收该值，不会自动生成或回显。

生产 Admin SSO 必须显式配置 HTTPS `ADMIN_SSO_ISSUER` 与非空
`ADMIN_SSO_CLIENT_ID`，不得从内部 runtime URL 猜测 issuer。JWKS、audience、
redirect 与 post-logout redirect 仅在显式提供时注入；redirect 未提供时由
Function 按 `SUPAUTH_PUBLIC_URL` 派生。安装器在 migrations 之后、secrets 与
Function 发布之前，只读统计 `supaoauth.security_config` 的 email/domain
allowlist 数量；Admin 只接受精确邮箱，发现任意 domain allowlist 条目即阻断。DB
邮箱优先，只有 DB 邮箱为空时才使用服务端 `ADMIN_SSO_ALLOWED_EMAILS` 回退。
没有精确邮箱时安装失败，allowlist 值不得出现在日志、浏览器、公共 SSO metadata
或 `VITE_*`。安装器还会从权威 SupaCloud 项目回读 Admin OAuth client，确认
public、`token_endpoint_auth_method=none`、精确单回调和 PKCE S256。

`ADMIN_SSO_REQUIRE_AAL2` 省略、为空或 `false` 时均不要求 AAL2；其他非空非法值会阻止 Function 启动。SupaCloud 中它的 Function 专属名称为 `EDGEFN_SUPAUTH_ADMIN_SSO_REQUIRE_AAL2`，专属变量即使显式为空也不会回退到项目级同名变量。无论该值如何，issuer、签名、audience、PKCE S256 和精确邮箱白名单都保持强制。它只能作为 Function 的服务器环境变量注入，禁止使用 `VITE_*`。完整的 AAL2、精确邮箱、PKCE 和 break-glass 基线见
[`docs/admin-sso-security.md`](./admin-sso-security.md)。

`bun run build` 是唯一构建入口。项目尚未发版，因此不保留额外兼容构建别名。

### 托管页面自定义

托管页面只接受 `supaoauth.sign_in_experience` 中的轻量品牌配置，包括
`page_title`、`primary_color`、`description`、`button_label`、`background_url`、
`custom_css` 和 `content`。其中 `content` 是 JSONB 结构化配置，例如
`{ "layout": "features", "items": [{ "icon": "shield", "title": "标准认证协议", "desc": "OAuth 2.0 / OIDC" }] }`，
由内置托管模板渲染为功能介绍。

任意 Custom UI HTML/JavaScript 上传在独立不可信 Origin 建成前固定返回
`501 capability_unavailable`。认证/Admin 同源上的 `/custom-ui/*` 和
`/v1/public/custom-ui/*` 固定返回 404，部署流程也不得把本地 `custom-ui/`
目录接入 Function。历史存储包保持不可执行，只能通过管理端 GET 读取安全状态，
或通过 DELETE 完成审计与清理。重新开放必须先建立独立 Origin、隔离 cookie、
CSP 与资源合同，并重新通过完整安全审查。

西谷“枢鉴”这类部署品牌使用租户配置落地，不写入开源默认源码。示例配置见 `config/sign-in-experience/xigu-shujian.json`，边界说明见 `docs/xigu-shujian-config.md`。可通过 `bun run tenant:apply-sign-in -- --base-url <auth-origin> --config <preset.json>` 写入目标环境；先加 `--dry-run` 检查 payload，再使用已换取的管理 session token 或 SSO access token 执行真实写入，不得把原始 `ADMIN_TOKEN` 直接作为 Bearer。

应用工具会同步 sign-in overlay，以及 preset 中可精确映射的 GoTrue `auth-config` 安全项，包括注册开关、密码最小长度和密码字符要求。`sign_in_methods` 只接受 GoTrue 已支持的方式；MFA 不提供伪全局开关，只使用 GoTrue TOTP、challenge 和真实 AAL。SSO 由 GoTrue/SupaCloud connector 配置启用。部署验收必须检查工具返回的两类 read-back，并对注册开关等项交叉验证 GoTrue `/auth/v1/settings`；不能仅以托管页面显示结果作为安全策略生效证据。

## Admin Console

- **技术栈**：SvelteKit + @svadmin/core + Tailwind v4
- **部署方式**：`packages/admin-console/build/**` 随 SupAuth 多文件 Function bundle 发布
- **路径前缀**：`/admin`
- **API 代理**：Vite dev 代理 `/api → localhost:4010` 的 Function emulator；生产环境由 SupaCloud 路由到 SupAuth Function

### 构建步骤

1. `bun run --filter '@supauth/admin-console' build`
2. 输出到 `packages/admin-console/build/`
3. 安装器把静态文件发布到 Function source 的 `admin-console/build/**`，`/admin/*` 深链回退到同 bundle 的 `index.html`

生产构建固定使用 `VITE_AUTH_SERVER_URL=/api`。Admin SPA 与 Function 同源，
不得把独立旧 API origin 或任何 Admin allowlist 写入浏览器 bundle。

## SupaCloud 路由配置

```yaml
# SupAuth Function routes declared by supacloud-app-manifest.json
- name: supaoauth-api
  paths:
    - /api/*
    - /v1/public/*
    - /oauth/*
    - /login
    - /login.html
    - /authorize.html
    - /claim
    - /claim.html
    - /admin/*
  target: supacloud-function:supauth

# Preserved Supabase-compatible runtime routes
- name: supacloud-runtime
  paths:
    - /auth/v1/*
    - /rest/v1/*
    - /storage/v1/*
    - /realtime/v1/*
    - /functions/v1/*
  target: supacloud-managed-runtime
```

## 安全边界

- 浏览器 **不直接持有** SupaCloud master token 或 service_role key
- 所有 SupaCloud API 调用通过 SupAuth Function (BFF) 代理
- Storage 上传/签名通过 SupAuth Function 代理
- 当前未完成验收的 GoTrue Passkey ceremony 不进入产品入口；旧兼容路由
  从 OpenAPI 隐藏并返回 `capability_unavailable`
- Webhook secrets、签名和 retry 状态由 SupaCloud Webhooks 管理；SupAuth Function 只提交事件 envelope
