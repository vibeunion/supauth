# Consent & Authorization Experience

> SupaOAuth task D1.3 / P1-3

## 概述

OAuth 2.0 授权流程中，用户需对应用请求的 scopes 做出同意（consent）决策。默认 `runtime_mode=gotrue` 下，SupaOAuth 不作为独立 token issuer；它在 GoTrue 默认 OAuth flow 之上提供 consent 策略、页面和审计层。

## Consent 类型

### 1. 用户级 Consent（交互式）
- **触发条件**：应用首次请求授权、请求了新 scope、之前 consent 被撤销
- **体验**：显示应用名称、请求的 scopes 列表，用户点击同意/拒绝
- **存储**：`supaoauth.user_consents` 表

### 2. Organization 级 Consent（上下文绑定）
- **触发条件**：用户在 org context 下授权，scope 涉及 org 资源
- **体验**：明确显示 org 上下文，用户确认以 org 成员身份授权
- **存储**：`supaoauth.user_consents` + `organization_id`

### 3. M2M 应用级（无交互授权）
- **触发条件**：`client_credentials` grant，应用间通信
- **体验**：无 consent UI，授权由管理员预先配置
- **存储**：`supaoauth.application_bindings`（已有的 binding 表）

## 数据模型

```sql
CREATE TABLE supaoauth.user_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  application_id VARCHAR(255) NOT NULL, -- GoTrue client_id
  scope_id UUID REFERENCES supaoauth.scopes(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES supaoauth.organizations(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  UNIQUE(user_id, application_id, scope_id, organization_id)
);
```

## 与 GoTrue OAuth flow 的集成

```
用户 → GoTrue /authorize
     → GoTrue 验证身份（login + MFA）
     → 重定向到 SupaOAuth /consent?client_id=...&scope=...&state=...
     → SupaOAuth 检查已有 consent
        → 已有 consent 且未变更 → 继续 GoTrue 授权回调（透明授权）
        → 新 scope 或无 consent → 显示 consent 页面
        → 用户同意 → 记录 consent → 继续 GoTrue 授权回调
     → GoTrue /token 交换 code
```

## 不与 GoTrue 默认 OAuth flow 冲突

- GoTrue 原生 `/authorize` 流程不变，SupaOAuth 在 GoTrue 完成身份验证后介入
- GoTrue 的 `redirect_uri` 指向 SupaOAuth consent endpoint，而非最终应用
- 用户拒绝 consent 时，按 GoTrue/OAuth 错误回调语义返回 `access_denied`
- 透明授权（已有 consent）不增加额外跳转延迟

## Admin Console 集成

- Applications 详情页显示 "Consent Settings"：是否需要显式 consent、consent 有效期
- Users 详情页显示 "Authorized Applications"：已授权的应用和 scopes，可撤销
- Organization 详情页显示 "Org Consent Policy"：是否强制 org context consent

## API Endpoints

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/consent` | 查询当前用户的 consents |
| POST | `/v1/consent` | 记录用户同意 |
| DELETE | `/v1/consent/:consentId` | 撤销 consent |
| GET | `/v1/users/:userId/consents` | 管理员查询用户的 consents |
| DELETE | `/v1/users/:userId/consents/:consentId` | 管理员撤销用户的 consent |

## 边界

- SupaOAuth **不实现** OAuth 授权码/token 签发 — GoTrue 负责
- SupaOAuth **自持** consent 记录和策略配置
- SupaOAuth **通过 BFF** 代理 consent 页面渲染
- SupaOAuth **不改变** Supabase OAuth access token 形态；token 仍应是可用于 RLS 的 Supabase JWT
- M2M 应用的授权范围由 `application_bindings` 表控制，不需要 consent 流程
