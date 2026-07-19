# Admin Console 功能与菜单对比

日期：2026-07-19
范围：SupaOAuth Admin Console 与 Logto 成熟管理体验的 GoTrue-only 对比。

## 结论

SupaOAuth 对齐 Logto 的菜单分组、命名、资源详情层级和管理体验，但不复制
GoTrue 无法兼容的 issuer 或协议功能。认证运行时唯一为 stock GoTrue；
浏览器管理请求统一经过 `/api/v1/*` BFF，认证 ceremony 才访问
`/auth/v1/*`。

## 一级菜单

Admin Console 保持六组、17 个 canonical 一级入口：

```text
概览
├─ 开始使用                  /get-started
└─ 仪表盘                    /dashboard

认证
├─ 应用                      /applications
├─ 登录体验                  /sign-in-experience
├─ 多因素认证                /mfa
├─ 连接器                    /connectors
├─ 企业 SSO                  /enterprise-sso
└─ 安全                      /security

授权
├─ API 资源                  /api-resources
├─ 角色                      /roles
└─ 组织模板                  /organization-template

用户
├─ 组织                      /organizations
└─ 用户                      /users

开发者
├─ 自定义 JWT                /customize-jwt
├─ Webhooks                  /webhooks
└─ 审计日志                  /audit-logs

租户
└─ 租户设置                  /tenant-settings
```

`/resources`、`/org-templates`、`/audit`、`/settings`、
`/account-center`、`/tenant-config` 和 `/operations` 保留 307 兼容跳转，
并保留 `/admin` base 与 query；URL fragment 不会发送到服务器，因此不属于
HTTP 307 可保留的输入。旧入口不建立第二套页面或数据状态。

## 功能对比

状态只使用“已完成”或“因 GoTrue/Supabase 兼容边界不适用”。

| Logto 域/功能 | SupaOAuth GoTrue-only 页面与能力 | 状态 |
| --- | --- | :---: |
| Get started | 核心配置检查与按域跳转 | 已完成 |
| Dashboard | GoTrue/OAuth 状态、兼容性与 capability 摘要 | 已完成 |
| Applications | Settings、Roles、Logs、Branding、Permissions、Rules、Organizations；仅提供 GoTrue 可证实的 secret 轮换 | 已完成 |
| Sign-in experience | Branding、Sign-up and sign-in、Collect user profile、Account center、Content | 已完成 |
| MFA | GoTrue TOTP、因子容量、用户因子和真实 AAL；不以因子存在猜测 AAL2 | 已完成 |
| Connectors | Passwordless/Social 目录、typed config、授权预检、测试与掩码 secret 状态 | 已完成 |
| Enterprise SSO | 入站 SAML/OIDC Connection、Experience 和 capability 可证实的 IdP-initiated 配置 | 已完成 |
| Security | Password policy、CAPTCHA、Blocklist、General，并显示权威 read-back 状态 | 已完成 |
| API resources | General、Permissions、资源编辑、Scope 生命周期和绑定冲突检查 | 已完成 |
| Roles | General、Permissions、Users、Machine-to-machine Apps，包含分配校验与撤销 | 已完成 |
| Organization template | 组织角色/权限模板及实例化 | 已完成 |
| Organizations | Settings、Members、Machine-to-machine、Branding、Invitations、JIT | 已完成 |
| Users | 创建、服务端分页搜索、Settings、Roles、Logs、Organizations、只读 GoTrue Grants；不提供 stock GoTrue 缺失的管理员 Grant 撤销 | 已完成 |
| Customize JWT | GoTrue Custom Access Token Hook；保护 Supabase 必需 claims，企业扩展只进入 schema v2 `app_metadata.supaoauth.projects[projectRef]` | 已完成 |
| Webhooks | Settings、Recent requests、delivery 详情及按 delivery ID 重放 | 已完成 |
| Audit logs | cursor 列表、详情深链、资源关联、导出和完整性状态 | 已完成 |
| Tenant settings | Settings、Domains、OIDC configs、Members、Advanced、Diagnostics；协作者权限与最后 Owner 保护 | 已完成 |
| Account center | 已归入 Sign-in experience 的 Account center 页签；当前用户 Bearer 可管理自己的 Grants、由 `manual_linking_enabled` 单独 opt-in 的 Identity linking/unlinking、TOTP 与 scoped logout | 已完成 |
| Consents | Applications 管理展示策略；授权 ceremony 和当前用户 Grant 管理均以 GoTrue 为事实源 | 已完成 |
| Operations | 已归入 Tenant settings/Diagnostics | 已完成 |
| Attribute Mapping / Outbound SAML Application | 当前产品只支持入站企业 SSO | 因 GoTrue/Supabase 兼容边界不适用 |
| RFC 8693 Token Exchange、Subject Token、通用 One-time Bearer Token | 不建立替代凭据或换签服务 | 因 GoTrue/Supabase 兼容边界不适用 |
| Personal Access Token | 不建立 GoTrue 之外的长期用户凭据 | 因 GoTrue/Supabase 兼容边界不适用 |
| Inline Hooks | stock GoTrue 没有任意代码同步触发点；仅使用文档化 Auth Hooks | 因 GoTrue/Supabase 兼容边界不适用 |
| Passkey 注册入口、MFA 备份码 | 当前无完成验收的 GoTrue ceremony，且不建立本地 credential/recovery store | 因 GoTrue/Supabase 兼容边界不适用 |
| 独立 issuer/discovery/JWKS/Session/MFA | 唯一运行时为 `gotrue` | 因 GoTrue/Supabase 兼容边界不适用 |

## 详情页层级

| 资源 | Canonical 详情页签 |
| --- | --- |
| Applications | Settings / Roles / Logs / Branding / Permissions / Rules / Organizations |
| Users | Settings / Roles / Logs / Organizations / Grants |
| Organizations | Settings / Members / Machine-to-machine / Branding |
| Roles | General / Permissions / Users / Machine-to-machine Apps |
| Webhooks | Settings / Recent requests |
| API resources | General / Permissions |
| Security | Password policy / CAPTCHA / Blocklist / General |

Applications 不显示 Attribute Mapping；Users 不显示 PAT；MFA 不显示备份码或
未验收的注册入口；导航不包含 Inline Hooks 或 SAML Application 类型。

## 状态与权限契约

- 页面分别呈现 empty、403、404、unsupported 与 unavailable，不用失败
  `catch` 伪装空列表。
- 菜单隐藏只改善体验，不能代替 BFF 的 `*.read`、`*.manage`、
  `audit.export`、`webhooks.replay` 和 `tenant.members.*` 服务端校验。
- `GET /v1/capabilities` 的 `available`、`source`、`version`、
  `reason_code` 决定 capability 页面和动作是否可用。
- Connector、CAPTCHA、Webhook 和 Auth Hook secret 只显示掩码状态，不进入
  浏览器 payload、日志或审计详情。

## 参考基线

- [Logto Sidebar](https://github.com/logto-io/logto/blob/c751ac0e9e703d2ff5572719794103cb55b668d5/packages/console/src/containers/ConsoleContent/Sidebar/hook.tsx)
- [Logto route tree](https://github.com/logto-io/logto/blob/c751ac0e9e703d2ff5572719794103cb55b668d5/packages/console/src/hooks/use-console-routes/index.tsx)
- [Logto resource tabs](https://github.com/logto-io/logto/blob/c751ac0e9e703d2ff5572719794103cb55b668d5/packages/console/src/consts/page-tabs.ts)

Auth0、Keycloak 与 Clerk 只用于交叉校验通用 IAM 分域，不作为协议或视觉
复制目标。
