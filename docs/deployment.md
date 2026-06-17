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
- **认证**：开发模式用 ADMIN_TOKEN，生产模式用 @svadmin/sso session

### 部署步骤

1. 构建 SupaCloud app artifact：`bun run build`
2. SupaCloud 读取 `artifacts/supacloud-app/supacloud-app-manifest.json`
3. SupaCloud 注入 `SUPACLOUD_INTERNAL_API_URL`、`SUPACLOUD_INTERNAL_TOKEN`、`SUPACLOUD_PROJECT_REF`、`SUPACLOUD_RUNTIME_URL`、`SUPAUTH_PUBLIC_URL`、`SUPACLOUD_DATABASE_URL`
4. 对 `SUPACLOUD_DATABASE_URL` 执行 migration：`bun run --filter '@supauth/auth-server' migrate`
5. 将 `packages/auth-server/dist/supacloud-function/supacloud-function.js` 发布到 SupaCloud Functions
6. 将 `packages/admin-console/build` 发布到 SupaCloud Pages/static hosting
7. 按 manifest 将 `/api/*`（strip `/api`）、`/v1/public/*`、`/oauth/*`、`/login.html`、`/claim`、`/claim.html` 路由到 Function
8. 按 manifest 的 `supacloud_owned_management_domains` 确认 Applications、Users、Organizations、RBAC、Audit、Webhooks 等管理面由 SupaCloud Management API 提供，SupAuth Function 只做 BFF/facade 和 overlay。
9. 按 manifest 的 `supacloud_managed_background_jobs` 确认 webhook 投递、重试、诊断和失败禁用由 SupaCloud 托管任务执行；SupAuth 不部署 webhook worker、cron 或 systemd/pm2 进程。
10. 安装完成后运行 live verifier：
    `SUPAUTH_PUBLIC_URL=https://auth.example.com SUPAUTH_INSTALLED_RUNTIME_URL=https://project.example.com bun run scripts/verify-supacloud-installed-app.ts --artifact-dir artifacts/supacloud-app`

`SUPAUTH_PUBLIC_URL` 是浏览器可见的 SupAuth/Auth 自定义域名，OAuth/SSO 跳转会优先使用它；`SUPACLOUD_RUNTIME_URL` 只用于 GoTrue/Supabase runtime 内部或保留路径探测。仅在反向代理会清洗并独占 `X-Forwarded-*` 请求头时，才设置 `TRUST_PROXY_HEADERS=1`。

`bun run build` 是唯一构建入口。项目尚未发版，因此不保留额外兼容构建别名。

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
    - /login.html
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
