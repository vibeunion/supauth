# Logto Interface Comparison — GoTrue-only

日期：2026-07-19

## 参考范围

- Logto 源码基线：`b92d584bc8c40399058c2c3a59f632c464d5708e`
- Logto 接口来源：`packages/core/src/routes/**/*.openapi.json`
- SupaOAuth 接口来源：`bun run scripts/export-openapi.ts`

“模仿 Logto”只表示对齐菜单分组、资源详情层级、权限边界和成熟管理体验，
不表示复制 Logto 的 issuer、协议扩展、视觉资产或云计费能力。

## 权威边界

- GoTrue 独占 `auth.users`、Identity、OAuth clients/Grants、JWT/JWKS、
  Session、Refresh Token、MFA 和 `/auth/v1/*`。
- SupaCloud 独占 Applications 控制面元数据、业务 Organizations、RBAC、
  tenant collaborators、Webhook、Audit、Providers 和 Secret Manager。
- SupaOAuth 是 BFF、Admin Console 和 additive overlay；管理 facade 不改变
  底层资源权威。

## 功能对比

状态使用“已完成”、“部分完成（保留边界）”或“因 GoTrue/Supabase 兼容边界不适用”。

| Logto 域/功能 | SupaOAuth GoTrue-only 实现 | 状态 |
| --- | --- | :---: |
| Applications | CRUD、单一 GoTrue client secret 轮换、Roles、Logs、Branding、Permissions、Rules、Organizations | 已完成 |
| Users | 创建、服务端分页搜索、Settings、Roles、Logs、Organizations、只读 GoTrue Grants；不虚构管理员 session、identity unlink 或 Grant 撤销 | 已完成 |
| My account | 当前用户 Bearer profile、GoTrue Grants、由 `manual_linking_enabled` 单独 opt-in 的 Identity linking/unlinking、TOTP 与 `local`/`global`/`others` scoped logout | 已完成 |
| Organizations | 业务组织、Members、Invitations、JIT、Machine-to-machine Applications、Branding | 已完成 |
| Roles / permissions | 用户或应用 XOR 分配、目标存在性校验、查询与撤销 | 已完成 |
| API resources / scopes | General、Permissions、资源编辑、Scope 生命周期和绑定冲突检查 | 已完成 |
| Connectors / CAPTCHA | 入站连接器目录、typed config、测试、CAPTCHA 配置；secret 仅在 SupaCloud Secret Manager | 已完成 |
| Enterprise SSO | GoTrue/SupaCloud 支持的入站 SAML/OIDC Connection、Experience 和可证实的 IdP-initiated 配置 | 已完成 |
| Sign-in experience | Branding、Sign-up and sign-in、Collect user profile、Account center、Content | 已完成 |
| Security | Password policy、CAPTCHA、Blocklist、General；保存后权威 read-back | 已完成 |
| MFA | GoTrue TOTP、因子容量、用户因子和真实 AAL 状态 | 已完成 |
| Customize JWT | GoTrue Custom Access Token Hook 注册/验证；必需 claims 与顶层 `role` 保护 | 已完成 |
| Webhooks | SupaCloud durable outbox、重试、DLQ、幂等、版本化签名、delivery 详情及按 delivery ID 重放；Organization/RBAC 事件与其 SupaCloud 变更同事务，GoTrue 用户和跨系统管理事件保留 post-mutation 边界 | 部分完成（保留跨系统原子性边界） |
| Audit logs | 权威 actor/request ID、cursor 分页、递归脱敏、详情、导出、append-only 与完整性 checkpoint | 已完成 |
| Tenant members | 项目协作者、邀请、角色更新、最后 Owner 保护和服务端授权 | 已完成 |
| RFC 8693 Token Exchange、Subject Token、通用 One-time Bearer Token | stock GoTrue 不提供对应产品语义；Token Exchange 继续返回 `unsupported_grant_type` | 因 GoTrue/Supabase 兼容边界不适用 |
| Personal Access Token / PAT 换 JWT | 会建立 GoTrue 之外的长期凭据与换签路径 | 因 GoTrue/Supabase 兼容边界不适用 |
| Outbound SAML Application / SupaOAuth 作为 SAML IdP | 当前产品只支持入站企业 SSO | 因 GoTrue/Supabase 兼容边界不适用 |
| 任意 Inline Hooks | stock GoTrue 没有对应同步触发点；仅使用文档化 Auth Hooks | 因 GoTrue/Supabase 兼容边界不适用 |
| Passkey 产品入口、MFA 备份码 | 当前没有经过完整验收的 GoTrue ceremony，且不建立本地 credential/recovery store | 因 GoTrue/Supabase 兼容边界不适用 |
| `external_oidc` issuer、独立 discovery/JWKS、Session/MFA/签名密钥 | 唯一运行时为 `gotrue`；其他值在启动/安装时失败 | 因 GoTrue/Supabase 兼容边界不适用 |

## Webhook 保证边界

- `organization.created`、`organization.invitation_created`、
  `organization.member_added`、`organization.member_updated`、
  `organization.member_removed`、
  `role.assigned`、`role.revoked` 标记为 `transactional`：业务变更和
  SupaCloud outbox 写入在同一个控制面数据库事务内提交。
- 用户、Application、Connector 和 Organization Template 的已发布事件标记为
  `post_mutation`：底层变更成功后再向 SupaCloud 提交事件。GoTrue mutation 与
  SupaCloud outbox 之间没有跨系统事务或 saga，不宣称原子性。
- durable 投递、重试和重放保证从事件成功进入 SupaCloud outbox 后开始。若
  post-mutation 提交失败，已成功的底层变更不会由 Webhook 层自动回滚。
- `/v1/webhooks/events` 继续返回兼容的 `events: string[]`，并通过 `catalog`
  为每个真实生产事件返回 `transactional` 或 `post_mutation` 元数据。没有真实
  生产者的事件不列入支持目录。

## 契约

- 控制面浏览器请求只访问 `/api/v1/*`；认证 ceremony 才访问
  `/auth/v1/*`。
- 404、501 与上游不可用不得转换为空列表；错误保留 `code`、`message`、
  `correlation_id`。
- 兼容窗口中的已移除路由必须从导航和 OpenAPI 隐藏，并返回
  `capability_unavailable`；窗口结束后删除。
- GoTrue Grants 是唯一有效 OAuth 授权事实源；SupaOAuth consent 记录仅用于
  策略与决策审计。
