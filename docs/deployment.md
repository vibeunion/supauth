# Deployment Topology

> SupaOAuth task P2-1

## 架构总览

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
│ Admin   │ │ Auth    │ │ GoTrue  │ │ Storage │ │ PostgREST│
│ Console │ │ Server  │ │ (OIDC) │ │ API     │ │          │
│ (static)│ │ (BFF)   │ │         │ │         │ │          │
│ :5173   │ │ :4010   │ │ :9999   │ │ :5000   │ │ :3000   │
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
| Admin Console | `/admin` | SvelteKit SPA，静态文件由 Nginx/Kong serve |
| Auth Server (BFF) | `/api/v1/*` | Elysia/Bun，管理 API + BFF 代理 |
| GoTrue (runtime) | `/auth/v1/*` | OIDC 端点，SupaOAuth 不替代 |
| Storage | `/storage/v1/*` | 文件存储，SupaOAuth BFF 代理敏感操作 |
| PostgREST | `/rest/v1/*` | 数据 API，不与 SupaOAuth 冲突 |
| Realtime | `/realtime/v1/*` | WebSocket，不与 SupaOAuth 冲突 |
| JWKS | `/auth/v1/.well-known/jwks.json` | GoTrue 签发，SupaOAuth 只读取 |
| Discovery | `/auth/v1/.well-known/openid-configuration` | GoTrue 签发，SupaOAuth 代理到 BFF |

## SupaOAuth Auth Server (BFF)

- **技术栈**：Elysia + Bun + drizzle-orm + postgres.js
- **端口**：4010
- **环境变量**：见 `.env.example`
- **数据库**：共享 SupaCloud 的 Postgres 实例，使用 `supaoauth` schema
- **认证**：开发模式用 ADMIN_TOKEN，生产模式用 @svadmin/sso session

### 部署步骤

1. 构建镜像：`bun build src/index.ts --outdir dist --target bun`
2. 配置环境变量（DATABASE_URL, SUPACLOUD_* 等）
3. 运行 migration：`bun run migrate`
4. 启动服务：`bun run dist/index.js`

## Admin Console

- **技术栈**：SvelteKit + @svadmin/core + Tailwind v4
- **部署方式**：静态文件（adapter-static）
- **路径前缀**：`/admin`
- **API 代理**：Vite dev 代理 `/api → localhost:4010`，生产环境由 Kong 路由

### 构建步骤

1. `bun run --filter '@supauth/admin-console' build`
2. 输出到 `packages/admin-console/build/`
3. Nginx/Kong 配置 `/admin/*` 指向静态文件

## Kong 路由配置

```yaml
# SupaOAuth Management API
- name: supaoauth-api
  paths:
    - /api/v1
  service: supaoauth-auth-server

# SupaOAuth Admin Console (static)
- name: supaoauth-admin
  paths:
    - /admin
  service: supaoauth-static

# GoTrue (untouched)
- name: gotrue-auth
  paths:
    - /auth/v1
  service: gotrue
```

## 安全边界

- 浏览器 **不直接持有** SupaCloud master token 或 service_role key
- 所有 SupaCloud API 调用通过 Auth Server (BFF) 代理
- Storage 上传/签名通过 BFF 代理
- GoTrue WebAuthn endpoint 通过 BFF 代理（未来）
