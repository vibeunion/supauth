# Logto Interface Gap Analysis

日期：2026-05-25

## Source

- Logto 源码：`/Users/zhd/Documents/Codex/2026-05-25/logto-interface-compare/logto-source-b92d584`
- Logto commit：`b92d584bc8c40399058c2c3a59f632c464d5708e`
- Logto 接口来源：`packages/core/src/routes/**/*.openapi.json`
- Logto 接口规模：76 个 OpenAPI 片段，230 个 path，341 个 operation
- SupaOAuth 接口来源：`bun run scripts/export-openapi.ts /tmp/supaoauth-openapi-current.json`
- SupaOAuth 当前规模：79 个 path，110 个 operation

## 判断原则

SupaOAuth 不应 1:1 复刻 Logto。默认架构仍是：

- GoTrue 负责 Supabase-compatible Auth runtime、token、session、JWKS、OIDC 核心协议。
- SupaOAuth 负责 Logto-like product control plane、metadata、组织/RBAC/consent、管理 API 和 admin console。
- SupaCloud 负责 infra orchestration、Kong route、GoTrue env injection、Storage/Pages/Functions 等运行时编排。

因此，Logto 的 OIDC runtime、legacy interaction runtime、部分 cloud-only/protected-app 能力不直接进入 SupaOAuth 默认实现；但与独立 IdP 产品体验、B2B 组织授权、第三方应用 consent、连接器配置和生产运维相关的接口，应补齐。

## Interface Comparison

| Logto 接口族 | Logto 代表接口 | SupaOAuth 当前覆盖 | 是否需要实现 |
| --- | --- | --- | --- |
| Applications | `/api/applications`, `/api/applications/{id}/secrets`, `/api/applications/{id}/roles`, `/api/applications/{id}/user-consent-scopes`, `/api/applications/{id}/users/{userId}/consent-organizations`, per-app sign-in experience | 已有应用 CRUD、secret rotate、resource/scope bindings；缺多 secret 生命周期、第三方应用 consent 配置、app custom data、per-app branding/sign-in experience | 需要。第三方 OAuth client 和无停机 secret rotation 是生产能力 |
| Users / My account | `/api/my-account/*`, `/api/users/{userId}/profile`, sessions, identities, MFA verifications, grants, personal access tokens | 已有 user list/get/delete、roles/permissions、passkeys；缺用户自助账号中心、admin 侧 profile/session/identity/MFA proxy | 需要。GoTrue 可继续做 runtime，但 SupaOAuth 需要账号中心 BFF |
| Organizations | `/api/organization-roles`, `/api/organization-scopes`, `/api/organizations/{id}/users/*`, `/api/organizations/{id}/applications/*`, JIT email domains / SSO connectors / roles, invitations | 已有 organizations CRUD、members、org templates、enterprise SSO 基线；缺邀请、显式 JIT 管理接口、组织应用/M2M 绑定、组织 roles/scopes first-class API | 需要。B2B / multi-tenant IdP 的核心能力 |
| Connectors | `/api/connector-factories`, `/api/connectors/{id}/authorization-uri`, `/api/connectors/{factoryId}/test`, `/api/sso-connector-providers`, captcha provider | 已有 connector list/get/update/test 和 enterprise-sso 配置；缺 provider catalog、typed config schema、authorization-uri preflight、captcha provider config | 需要。否则 connector 配置仍偏手工，难以生产自助 |
| Email / verification / templates | `/api/email-templates`, `/api/verification-codes`, `/api/experience/verification/*` | 主要依赖 GoTrue/SupaCloud runtime；SupaOAuth 仅有 security-config 和 storage proxy | 需要控制面代理。不要重写验证码 runtime，但要能管理 SMTP/SMS/captcha/template 配置 |
| Experience / Sign-in UI | `/api/experience/*`, `/api/sign-in-exp/*`, custom UI assets, well-known phrases | 已有 sign-in-experience 配置和 branding storage；缺 phrases/custom UI assets/custom profile fields/check-password 等 | 部分需要。默认不替换 GoTrue runtime，但产品层需要 branding、phrases、profile fields、password policy proxy |
| Webhooks / logs | `/api/hooks/{id}/recent-logs`, `/api/hooks/{id}/test`, `/api/hooks/{id}/signing-key`, `/api/logs/{id}` | 已有 webhook CRUD/events/rotate-secret 和 audit list；缺 delivery logs、test、replay、audit detail | 需要。生产排障和 webhook onboarding 必需 |
| Domains / config | `/api/domains`, `/api/configs/oidc/*`, admin console config | 已有 provisioning、runtime discovery/JWKS、auth-config proxy；缺 custom domain/SSL 生命周期、OIDC key/config 可视化、admin console public config | 需要。通过 SupaCloud/Kong/GoTrue 编排实现，不直接绕过 SupaCloud |
| SAML / token exchange / PAT | `/api/saml-applications`, `/api/subject-tokens`, `/api/users/{userId}/personal-access-tokens`, one-time tokens | 基本未覆盖 | 暂不列入 GA 必做。SAML app、token exchange、PAT 属扩展产品线；除非目标客户明确需要，否则先做 decision spike |

## New Tasks To Track

这些缺口已经追加到 `progress.md`：

- P0-24 Application secret lifecycle and third-party consent configuration
- P1-12 Account Center and admin user management proxy
- P1-13 Organization invitation, JIT, and organization application APIs
- P1-14 Connector factory, provider catalog, captcha, and template configuration
- P1-15 Webhook delivery diagnostics and audit detail
- P1-16 Domain, branding, phrases, and custom profile fields
- P2-7 SAML / token exchange / PAT decision spike

