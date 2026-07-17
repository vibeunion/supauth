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

当前西谷线上环境有两个 SupaCloud project ref：`dglewlzugrtygzysqrce` 是业务生产项目，`vwsvexjelurvczfivgiz` 是 SupAuth 开源验证项目。数据库迁移、生产配置和线上验收前，先按 `docs/live-projects.md` 确认目标项目，避免把验证项目当作业务库操作。

| 服务 | 路径 | 说明 |
|------|------|------|
| Admin Console | `/admin` | SvelteKit SPA，由 SupaCloud Pages/static hosting 托管 |
| SupAuth Function (BFF) | `/api/v1/*`, `/v1/public/*`, `/oauth/sso/authorize` | SupaCloud Function 调用 `supacloud-function.ts` |
| GoTrue (runtime) | `/auth/v1/*` | OIDC 端点，SupaOAuth 不替代 |
| Storage | `/storage/v1/*` | 文件存储，SupAuth Function 代理敏感操作 |
| PostgREST | `/rest/v1/*` | 数据 API，不与 SupaOAuth 冲突 |
| Realtime | `/realtime/v1/*` | WebSocket，不与 SupaOAuth 冲突 |
| JWKS | `/auth/v1/.well-known/jwks.json` | GoTrue 签发，SupaOAuth 只读取 |
| Discovery | `/auth/v1/.well-known/openid-configuration` | GoTrue 签发，SupaOAuth 代理到 BFF |

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
3. SupaCloud 注入 `SUPACLOUD_INTERNAL_API_URL`、`SUPACLOUD_INTERNAL_TOKEN`、`SUPACLOUD_PROJECT_REF`、`SUPACLOUD_RUNTIME_URL`、`SUPAUTH_PUBLIC_URL`、`SUPACLOUD_DATABASE_URL`
4. 对 `SUPACLOUD_DATABASE_URL` 执行 migration：`bun run --filter '@supauth/auth-server' migrate`
5. 将 `packages/auth-server/dist/supacloud-function/supacloud-function.js` 发布到 SupaCloud Functions
6. 将 `packages/admin-console/build` 发布到 SupaCloud Pages/static hosting
7. 按 manifest 将 `/api/*`（strip `/api`）、`/v1/public/*`、`/oauth/*`、`/login`、`/login.html`、`/authorize.html`、`/claim`、`/claim.html` 路由到 Function
8. 按 manifest 的 `supacloud_owned_management_domains` 确认 Applications、Users、Organizations、RBAC、Audit、Webhooks 等管理面由 SupaCloud Management API 提供，SupAuth Function 只做 BFF/facade 和 overlay。
9. 按 manifest 的 `supacloud_managed_background_jobs` 确认 webhook 投递、重试、诊断和失败禁用由 SupaCloud 托管任务执行；SupAuth 不部署 webhook worker、cron 或 systemd/pm2 进程。
10. 安装完成后运行 live verifier：
    `SUPAUTH_PUBLIC_URL=https://auth.example.com SUPAUTH_INSTALLED_RUNTIME_URL=https://project.example.com bun run scripts/verify-supacloud-installed-app.ts --artifact-dir artifacts/supacloud-app`

`SUPAUTH_PUBLIC_URL` 是浏览器可见的 SupAuth/Auth 自定义域名，OAuth/SSO 跳转会优先使用它；`SUPACLOUD_RUNTIME_URL` 只用于 GoTrue/Supabase runtime 内部或保留路径探测。仅在反向代理会清洗并独占 `X-Forwarded-*` 请求头时，才设置 `TRUST_PROXY_HEADERS=1`。

`bun run build` 是唯一构建入口。项目尚未发版，因此不保留额外兼容构建别名。

### 托管页面自定义

托管页面自定义分为两层：

1. 轻量品牌配置存 `supaoauth.sign_in_experience`，包括 `page_title`、`primary_color`、`description`、`button_label`、`background_url`、`custom_css` 和 `content`。其中 `content` 是 JSONB 结构化配置，例如 `{ "layout": "features", "items": [{ "icon": "shield", "title": "标准认证协议", "desc": "OAuth 2.0 / OIDC" }] }`，由默认托管模板渲染为功能介绍。
2. 完整页面替换使用 `custom-ui/` 静态目录。运行时会优先读取 `custom-ui/login.html` 或 `custom-ui/index.html` 覆盖登录页，也会读取 `custom-ui/claim.html`、`custom-ui/change-password.html`、`custom-ui/account.html` 分别覆盖领取、改密、账户中心页面；`/custom-ui/*` 用于引用同目录下的图片、SVG、字体和脚本。该目录通过部署流程同步到服务器，不提交到 git。

仓库已忽略 `custom-ui/` 与 `packages/auth-server/custom-ui/`。默认开源模板只保留中性布局和渲染能力，具体业务文案、视觉和完整页面资源应来自数据库配置或部署目录。

西谷“枢鉴”这类部署品牌使用租户配置落地，不写入开源默认源码。示例配置见 `config/sign-in-experience/xigu-shujian.json`，边界说明见 `docs/xigu-shujian-config.md`。可通过 `bun run tenant:apply-sign-in -- --base-url <auth-origin> --config <preset.json>` 写入目标环境；先加 `--dry-run` 检查 payload，再使用已换取的管理 session token 或 SSO access token 执行真实写入，不得把原始 `ADMIN_TOKEN` 直接作为 Bearer。

应用工具会同步 sign-in overlay，以及 preset 中可精确映射的 GoTrue `auth-config` 安全项，包括注册开关、密码最小长度和密码字符要求。`sign_in_methods` 与 `mfa_required` 仍是 overlay metadata，SSO 由 connector/SAML 配置启用，MFA 强制需要 challenge 与 AAL2 策略。部署验收必须检查工具返回的两类 read-back，并对注册开关等项交叉验证 GoTrue `/auth/v1/settings`；不能仅以托管页面显示结果作为安全策略生效证据。

## Admin Console

- **技术栈**：SvelteKit + @svadmin/core + Tailwind v4
- **部署方式**：SupaCloud Pages/static hosting
- **路径前缀**：`/admin`
- **API 代理**：Vite dev 代理 `/api → localhost:4010` 的 Function emulator；生产环境由 SupaCloud 路由到 SupAuth Function

### 构建步骤

1. `bun run --filter '@supauth/admin-console' build`
2. 输出到 `packages/admin-console/build/`
3. SupaCloud Pages 配置 `/admin/*` 指向静态文件

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
  target: supacloud-function:supauth

# SupAuth Admin Console Pages
- name: supaoauth-admin
  paths:
    - /admin/*
  target: supacloud-pages:supauth-admin

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
- GoTrue WebAuthn endpoint 通过 SupAuth Function 代理（未来）
- Webhook secrets、签名和 retry 状态由 SupaCloud Webhooks 管理；SupAuth Function 只提交事件 envelope
