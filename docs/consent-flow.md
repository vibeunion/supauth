# Consent & Authorization Experience

> SupaOAuth task D1.3 / P1-3

## 概述

OAuth 2.0 授权流程中，用户需对应用请求的 scopes 做出同意（consent）决策。默认 `runtime_mode=gotrue` 下，SupaOAuth 不作为独立 token issuer；它在 GoTrue 默认 OAuth flow 之上提供 consent 策略、页面和审计层。

## Consent 类型

### 1. 用户级 Consent（交互式）
- **触发条件**：应用首次请求授权、请求了新 scope、之前 consent 被撤销
- **体验**：显示应用名称、请求的 scopes 列表，用户点击同意/拒绝
- **授权事实源**：GoTrue OAuth authorization / Grant
- **SupaOAuth overlay**：`application_consent_settings` 保存展示策略，`oauth_consent_decisions` 保存决定与 correlation 审计

### 2. Organization 级 Consent（上下文绑定）
- **触发条件**：用户在 org context 下授权，scope 涉及 org 资源
- **体验**：明确显示 org 上下文，用户确认以 org 成员身份授权
- **授权事实源**：GoTrue Grant；SupaCloud Organization / application binding 提供业务上下文
- **SupaOAuth overlay**：decision audit 可记录 `organization_id`，但不能据此伪造或替代 Grant

### 3. M2M 应用级（无交互授权）
- **触发条件**：`client_credentials` grant，应用间通信
- **体验**：无 consent UI，授权由管理员预先配置
- **授权事实源**：GoTrue OAuth client 与授权运行时
- **控制面**：SupaCloud RBAC、Organization application binding 和 SupaOAuth API resource policy

## 数据模型

```sql
CREATE TABLE supaoauth.oauth_consent_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_id VARCHAR(255),
  user_id UUID NOT NULL,
  application_id VARCHAR(255) NOT NULL,
  requested_scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  organization_id VARCHAR(255),
  decision VARCHAR(16) NOT NULL CHECK (decision IN ('approved', 'denied')),
  grant_id VARCHAR(255),
  request_id VARCHAR(255),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

历史安装可能保留 `supaoauth.user_consents`，但它只允许作为只读历史记录；任何有效 Grant 查询与撤销都必须回到 GoTrue。

## 与 GoTrue OAuth flow 的集成

```
用户 → GoTrue /authorize
     → GoTrue 验证身份（login + MFA）
     → SupaOAuth BFF 读取 GoTrue authorization / Grant 并应用展示策略
        → 已有 GoTrue Grant 且覆盖请求 scope → 继续 GoTrue 授权
        → 需要用户决定 → 显示 consent 页面
        → 用户决定 → 记录 decision audit，并调用 GoTrue consent action
     → GoTrue /token 交换 code
```

## 不与 GoTrue 默认 OAuth flow 冲突

- GoTrue 原生 `/authorize` 流程不变，SupaOAuth 在 GoTrue 完成身份验证后介入
- 用户拒绝 consent 时，按 GoTrue/OAuth 错误回调语义返回 `access_denied`
- SupaOAuth 不根据本地 consent 行签发、恢复或撤销 token

## Admin Console 集成

- Applications / Permissions 管理 consent 展示策略与资源绑定
- Users 详情只管理 Settings、Roles、Logs 与 Organizations，不提供 stock
  GoTrue 不具备的管理员 Grant 查询或撤销 facade
- Account Center 可由当前登录用户查看并撤销自己的 GoTrue Grants
- Organizations 管理成员、JIT 与 application binding，不建立第二套 OAuth Grant

## API Endpoints

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/public/oauth/authorizations/:authorizationId` | 以当前用户 Bearer 读取 GoTrue authorization details |
| POST | `/v1/public/oauth/authorizations/:authorizationId/consent` | 将 approve/deny 决策提交给 GoTrue，成功后写 decision audit |
| GET | `/v1/public/account/grants` | 当前用户读取自己的 GoTrue Grants |
| DELETE | `/v1/public/account/grants/:clientId` | 当前用户撤销指定 client 的 GoTrue Grant |

旧 `/v1/consents*` 管理接口仅保留兼容窗口：它们从 OpenAPI 隐藏并返回
`capability_unavailable`，不得作为有效管理 API 使用。

## 边界

- SupaOAuth **不实现** OAuth 授权码/token 签发 — GoTrue 负责
- SupaOAuth **自持** consent 展示策略和 decision audit，不持有有效 Grant
- SupaOAuth **通过 BFF** 代理 consent 页面渲染
- SupaOAuth **不改变** Supabase OAuth access token 形态；token 仍应是可用于 RLS 的 Supabase JWT
- M2M 的 OAuth 凭据与协议行为由 GoTrue 管理；业务资源范围由控制面策略约束
