# Security Capabilities — GoTrue-only Boundary

## 结论

SupaOAuth 只支持 stock GoTrue 认证运行时。GoTrue 独占用户、Identity、
OAuth/OIDC、Grants、JWT/JWKS、Session、Refresh Token、MFA 和
`/auth/v1/*`；SupaOAuth 与 SupaCloud 只提供管理 facade、配置编排和状态
验证，不建立第二套认证状态。

## 已完成能力

| 能力 | 权威源 | 管理方式 |
| --- | --- | --- |
| Email + Password、Magic Link、Phone OTP | GoTrue | SupaCloud provider/auth config；SupaOAuth BFF 只提交可精确映射的配置 |
| 密码策略 | GoTrue | 只允许最小长度和 GoTrue 可表达的字符组合；更新后 read-back |
| CAPTCHA | GoTrue/SupaCloud | 配置由 BFF 写入；secret 只存 SupaCloud Secret Manager，响应仅返回掩码状态 |
| Blocklist | GoTrue `before-user-created` Auth Hook | 服务端注册并验证 Hook；邀请状态来自权威 API；失败时显示“未生效” |
| TOTP MFA | GoTrue | enroll、challenge、verify、unenroll 均调用 `/auth/v1/factors*`；界面只展示真实 factor/AAL 数据 |
| JWT 定制 | GoTrue Custom Access Token Hook | 保留全部 Supabase 必需 claims；企业扩展仅放入有界 `app_metadata.supaoauth.projects[projectRef]` |
| Session / Refresh Token | GoTrue | 不提供管理员 session 清单或按 ID 撤销；Account Center 仅调用 stock GoTrue `local`、`global`、`others` scoped logout，不写本地 Session 表 |
| Identity | GoTrue | 管理端不提供 identity unlink；Account Center 仅在 `manual_linking_enabled` 与 identities 模块均启用时，由当前用户 Bearer 发起 manual linking、查询或解绑自己的 Identity；实验性 linking-domain map 另行 opt-in |

顶层 `role` 只允许 `anon`、`authenticated`、`service_role`。任何业务角色或
权限不得写入顶层 `role`，也不得覆盖 `app_metadata.role`；企业授权投影只能
位于 schema v2 的 `app_metadata.supaoauth.projects[projectRef]`。`supaoauth`
根只允许 `schema_version`、`projects` 和合法 `hook`；旧根级 RBAC 字段不读取、
不双写。

## 因 GoTrue/Supabase 兼容边界不适用

| 能力 | 处理 |
| --- | --- |
| 当前未完成真实 GoTrue ceremony 的 Passkey 注册/设备管理 | 不进入菜单、SDK 或 OpenAPI；兼容窗口路由隐藏并返回 `capability_unavailable` |
| MFA 备份码或本地 recovery-code store | 不提供，不建表 |
| 伪全局 `mfa_required` 开关 | 不提供；只展示真实 factor、容量和 AAL |
| 任意 Inline Hook / `post-sign-in` / `post-first-factor` | 不提供；只使用 stock GoTrue 文档化 Auth Hooks |
| 独立 issuer、独立 discovery/JWKS、独立 Session/MFA/签名密钥 | 不提供；配置为非 `gotrue` 时拒绝启动或安装 |

## 验证规则

- 密码、CAPTCHA、Blocklist、Auth Hook 配置必须服务端 read-back，不能仅凭
  页面保存成功判断已经生效。
- TOTP enrollment 响应中的 raw secret 仅用于当前 GoTrue ceremony，不进入
  日志、审计、浏览器持久化或 SupaOAuth 数据库。
- CAPTCHA、Connector、Webhook 和 Auth Hook secret 永不回显；审计数据递归
  脱敏。
- 管理 UI 的可见性不是授权边界；BFF 必须校验对应的 `*.read`、`*.manage`
  和高风险动作权限。
