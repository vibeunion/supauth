# Security Capabilities — MFA / Passkey / Passwordless Mapping

> SupaOAuth task S1.5 / D1.2

## GoTrue 已支持的能力（Supabase runtime 原生）

| 能力 | GoTrue 支持 | SupaOAuth 交互方式 |
|------|------------|-------------------|
| Email + Password | ✅ 核心流程 | SupaOAuth 通过 SupaCloud 配置 password policy |
| Magic Link (Passwordless) | ✅ `enable_signup` + `mailer` | 由 GoTrue/provider 配置和专用流程实现；`sign_in_methods` 目前只是 overlay metadata |
| Phone OTP (SMS) | ✅ Twilio / Vonage | SupaOAuth Connectors 页面配置 provider |
| TOTP MFA (App-based) | ✅ `mfa` 模块 | Account Center 管理 enrollment；`mfa_required` 目前不等于登录强制，需 challenge + AAL2 策略 |
| WebAuthn / Passkey | ✅ GoTrue >= 2.164 | SupaOAuth 需要 UI 展示 + 注册流程编排 |

## SupaCloud 可编排的能力

| 能力 | 编排方式 | SupaOAuth 需自持 |
|------|---------|-----------------|
| Password policy 配置 | SupaCloud `PATCH /config/auth` | ✅ preset apply 可同步最小长度和可表达的字符要求；其余组合拒绝近似 |
| MFA enrollment 强制策略 | SupaCloud `mfa_max_enrolled_factors` + 应用 AAL2 | ⚠️ 最大因子数不等于登录强制，需补 challenge/授权门禁 |
| Session 长度 / JWT expiry | SupaCloud `jwt_expiry` | ✅ 已在 Settings 页面 |
| Email confirmation 策略 | SupaCloud `enable_confirmations` | ✅ 已在 Settings 页面 |
| Anonymous users 开关 | SupaCloud `external_anonymous_users_enabled` | ✅ 已在 Settings 页面 |

## SupaOAuth 需自持的能力（GoTrue 不直接覆盖）

| 能力 | 实现策略 | 优先级 |
|------|---------|-------|
| Sign-in Experience UI 定制 | SupaOAuth DB 配置 + 前端渲染 | P1 |
| Organization-level MFA policy | supaoauth org metadata + sync to app_metadata | P1 |
| Role-based MFA requirement | supaoauth role metadata + sync | P2 |
| Passkey registration UI | GoTrue WebAuthn endpoint + SupaOAuth BFF wrapper | P2 |
| Passwordless flow config | GoTrue magic link + 专用 hosted flow；当前 sign-in method toggle 不编排流程 | P1 |

## GoTrue 不支持、SupaOAuth 未来可能覆盖

| 能力 | 说明 |
|------|------|
| FIDO2 device management | GoTrue 只做 enrollment/verify，不做 device list UI |
| Step-up authentication | 需 SupaOAuth 自持 challenge flow，GoTrue 不支持 |
| Adaptive MFA (risk-based) | 需 SupaOAuth 自持风险评估引擎 |
| SSO session binding | Enterprise SSO 登录后的 session 与 org 绑定 |

## Admin Console 页面

**Security Policy 页面**：
- MFA requirement toggle
- Password policy (min length, complexity rules)
- Session policy (JWT expiry)
- Sign-in method enable/disable (password, magic link, phone OTP, passkey)
- GoTrue auth config projection (sign-up, email confirmations, anonymous users, MFA factor limit)

**Runtime Health 页面**（Dashboard 子卡片）：
- GoTrue version + MFA module status
- WebAuthn endpoint availability check
- Active MFA factors count per user

## 与 GoTrue 的边界

- SupaOAuth **不重造** OIDC token signing、JWKS、session token — GoTrue runtime 负责
- SupaOAuth **编排** GoTrue 配置：auth config 和 provider；MFA 强制策略还必须在应用/API 层执行 challenge 与 AAL2 门禁
- Account Center 的 TOTP 绑定、验证、解绑只通过当前用户的 GoTrue Bearer token 调用 `/auth/v1/factors*`；BFF 和 route 层都必须过滤 enrollment payload 中的 raw `totp.secret`。用户自助入口不暴露管理面 reset；管理员重置 MFA 因子属于 Admin Console 治理能力。
- SupaOAuth **自持** organization-level 和 role-level 的安全策略 metadata
- SupaOAuth **通过 BFF** 代理 GoTrue WebAuthn endpoint，浏览器不直接访问 GoTrue
