# SupAuth / SupaOAuth 与 Logto Cloud、Logto 源码功能差异分析

日期：2026-08-04

## 1. 结论先行

SupaOAuth 与 Logto 的一级信息架构已经基本对齐：浏览器实测两者都呈现 6 个分组、17 个主要入口。当前真正的差距不在菜单数量，而在运行时能力、控制台深度和产品可观测性。

最重要的架构判断是：

- Logto 是完整身份运行时。它自己持有用户密码、MFA 凭据、OIDC session、grant、Access Token、refresh token、JWKS、Passkey、备份码、PAT、token exchange 和恢复流程。
- SupAuth 是 GoTrue/SupaCloud 之上的控制面与体验层。GoTrue 必须继续权威持有 `auth.users`、认证 ceremony、session、refresh token、MFA、JWT/JWKS 和 OAuth/OIDC。
- 因此，不能把 Logto 的数据库表或 token/session 实现复制到 SupAuth；应复制的是优秀的控制台体验、分析、诊断、策略表达和 capability-gated 管理能力。

建议结论：

1. **现在就加入**：身份分析、内置托管页实时预览、Custom UI 历史状态与删除入口、第三方应用/授权总览、用户会话/身份/grant 的能力状态视图、Webhook 运行指标、上下文帮助和全局搜索。
2. **先修正产品真相**：当前“自定义 JWT”不是可持久化的任意 claim policy；Security 页的 brute-force/max attempts 仅保护旧版/开发环境 `ADMIN_TOKEN` 登录来源 IP，不保护 GoTrue SSO 或终端用户 identifier，且生产环境禁用 token login。
3. **只有上游能力存在时加入**：Passkey、Phone/Email MFA、恢复码、组织 MFA、终端用户 identifier lockout、OTP expiry/retry、泄露密码检查、管理员 session/identity/grant mutation、真正的 `client_credentials`。
4. **暂不加入**：Logto PAT、subject token、one-time token、token exchange、任意认证 Actions 脚本、第二套 session/credential/recovery store。
5. **按业务再决定**：SAML IdP 应用、CIMD dynamic client、计费、AI 助手。即使建设，也必须是隔离的附加服务，不能改写 `/auth/v1/*` 或 Supabase SDK 合同。

## 2. 审查范围与证据边界

### 2.1 浏览器实测

- 使用已登录浏览器检查了 `https://cloud.logto.io/rmilj6/get-started` 及实际控制台页面。
- Logto 租户当前为免费套餐。付费功能虽不可编辑，但控制台明确展示的配置项可证明产品模型；没有把未展示的源码功能冒充为 Cloud 已上线能力。
- `https://auth.ai.xigu.team/admin` 可访问并跳转到 `/admin/get-started`，但当前浏览器没有 SupaOAuth 管理员会话，因此本报告没有把本地源码能力写成“已在线验收”。

### 2.2 Logto 源码基线

- 仓库：`https://github.com/logto-io/logto`
- 分支：`master`
- 固定提交：`6e2eb50ec58ac85d73f008ddf465eb9727cae838`
- 提交时间：`2026-08-04T13:46:59+08:00`
- 提交标题：`feat(console): add the dynamic app permissions tab (#9330)`
- `git ls-remote` 观察到的最新稳定标签：`v1.42.0`
- 分析范围：`packages/console`、`packages/core`、`packages/schemas`、`packages/experience`、`packages/connector-kit`、`packages/integration-tests`。

源码中的 `DEV`、feature flag、Cloud quota 或 “under development” 能力在本文中单独标记，不视为浏览器已上线能力。

### 2.3 SupaOAuth 源码基线

- 工作区：`/Users/zhd/workspace/supaoauth`
- 本地 `main`：`feb210d`
- 最终复核时 `origin/main`：`2fa924c`，本地落后 9 个提交；远端在审查期间仍有发布提交进入。
- 这 9 个提交主要涉及 Auth Server 发布、Edge Runtime 构建和 authorization kit；本报告直接检查当前工作区目标源码，不以旧的“落后 5 个提交”结论为依据。
- 工作区已有多项用户未提交修改。本轮在不覆盖这些修改的前提下实施了第 14 节列出的控制面修复；没有暂存、提交、推送、部署或改动生产环境。

### 2.4 报告状态说明

第 3～11 节保留 2026-08-04 初次浏览器/源码差异审查时的基线和建议，用于说明为什么要修。第 14 节是本轮修复后的当前实现状态；若前文“当前缺失/应加入”与第 14 节冲突，以第 14 节为准。

## 3. 两套系统的架构差异

| 层 | Logto | SupAuth / SupaOAuth | 对产品决策的含义 |
| --- | --- | --- | --- |
| 管理控制台 | React Console | SvelteKit Admin Console | 可以借鉴 IA、交互和可观测性 |
| 登录体验 | 独立 React Experience | Hosted pages + GoTrue ceremony；任意 Custom UI 仅能在未来独立不可信 Origin 中实现 | UI 可增强，认证流程归 GoTrue |
| 管理 API | Koa Management API | Elysia `/api/v1/*` BFF | Admin Console 继续只访问同源 BFF |
| OAuth/OIDC | 自有 `oidc-provider` 运行时 | GoTrue/SupaCloud 运行时 | 不能在 SupAuth 增加第二 issuer/token endpoint |
| 用户与密码 | Logto `users` 表 | GoTrue `auth.users` | SupAuth 不写第二套密码/用户权威 |
| Session / grant | Logto OIDC model + session extensions | GoTrue session/grant | 管理动作必须有上游 API 才开放 |
| MFA / Passkey | Logto `mfa_verifications` 与 verification records | GoTrue factors/AAL | 不在 overlay 保存凭据或恢复码 |
| 扩展数据 | Logto 全量身份 schema | `supaoauth` 控制面 metadata + SupaCloud 权威资源 | 只增加非认证权威数据 |
| JWT 扩展 | Logto 脚本运行器和 ID Token 配置 | GoTrue Custom Access Token Hook + 固定 namespace | 采用声明式、可审计映射，不支持任意覆盖 |

SupaOAuth 的定位不是“另一个 Logto”。它应成为 **Supabase 原生、GoTrue 兼容、可诊断、可治理的身份控制面**。

## 4. 信息架构对比

| 分组 | Logto Cloud 当前入口 | SupaOAuth 当前入口 | 结论 |
| --- | --- | --- | --- |
| 概览 | 开始上手、仪表盘 | 开始使用、仪表盘 | 已对齐 |
| 身份验证 | 应用、登录与账户、MFA、连接器、企业 SSO、安全 | 应用、登录体验、MFA、连接器、企业 SSO、安全 | IA 对齐，深度不同 |
| 授权 | API 资源、角色、组织模板 | API 资源、角色、组织模板 | 已对齐 |
| 用户 | 组织、用户管理 | 组织、用户 | 已对齐 |
| 开发者 | 自定义 JWT、Webhooks、审计日志 | 自定义 JWT、Webhooks、审计日志 | IA 对齐，JWT 语义不同 |
| 租户 | 租户设置 | 租户设置 | 已对齐，Cloud 商业项不同 |

不建议继续增加一级菜单。新增能力应进入现有 canonical route，避免重新形成重复导航。

## 5. 源码级功能差异矩阵

状态含义：

- **现在应加入**：控制面、体验或分析能力，不改变 GoTrue 权威。
- **上游门控**：只有 GoTrue/SupaCloud 提供可验证的权威接口后才能启用。
- **暂不加入**：会形成第二身份运行时或风险明显高于收益。
- **按业务决定**：可以隔离建设，但不是当前 SupAuth 核心目标。
- **SupaOAuth 更强**：保留现有差异化能力。

| 能力域 | Logto Cloud / 源码 | SupaOAuth 当前源码 | 评估 |
| --- | --- | --- | --- |
| 产品分析 | 总用户、今日/7 日新增、DAU/WAU/MAU、30 日曲线；发 token 时记录 active user | 仪表盘主要展示 OAuth 状态、issuer、OIDC endpoints 和兼容检查 | **现在应加入**，并保留现有协议诊断 |
| 应用类型 | Native、SPA、Traditional、M2M、Protected、SAML；区分 first/third party | public/confidential client；stock GoTrue 只允许 `authorization_code`、`refresh_token` | 第三方总览现在应加入；M2M/SAML 分别门控或按业务决定 |
| 第三方授权 | 第三方应用单独列表；用户和管理员均可查看/撤销 grant | 用户自助可查看/撤销；管理员可读 GoTrue grant，但 admin revoke fail-closed | 总览现在应加入；管理员 mutation **上游门控** |
| 用户 session | 用户与管理员均可列出 active session、查看详情、销毁并可选撤销关联 grant | 用户和管理员 session-by-id 路由明确 `capability_unavailable` | 先做状态视图；实际操作 **上游门控** |
| 身份管理 | social identity、SSO identity 详情；账户和管理员管理接口 | 管理员只读 identities；用户自助 linking/unlink 可走 GoTrue，管理员 unlink unavailable | 完善自助 UI；管理员 mutation **上游门控** |
| PAT | 每用户 PAT，支持过期、重命名、删除，值以 `pat_` 开头并入库 | 无 | **暂不加入**，避免第二 bearer-token 权威 |
| Subject token / impersonation | 独立 `subject_tokens`；token exchange 可消费 impersonation token | 无 | **暂不加入**；若未来需要 impersonation，应先由 GoTrue/SupaCloud 定义审计和 token 合同 |
| Token exchange | 自有 `urn:ietf:params:oauth:grant-type:token-exchange`，可结合 actor/subject/organization | 无 | **暂不加入**，不能在 BFF 自行发 token |
| One-time token | 独立 email/token/status/context/expiry 表和验证流程 | 有业务性账号领取流程，但不是 OAuth token issuer | 不复制 Logto token 模型；现有领取流程继续一次性、业务隔离 |
| M2M | 自有 `client_credentials`，支持 resource 和 organization token | 应用层可分配 M2M 角色，但 GoTrue 不发 `client_credentials` token | **上游门控**；不能把角色配置误报为 token 能力 |
| MFA | TOTP、WebAuthn、Email/Phone code、备份码；可选/强制/提示策略 | 正式支持 TOTP 和最大 factors；Passkey 路由 fail-closed | 多因素 **上游门控**；控制台可先改成“因素 + 策略 + 覆盖率” |
| Passkey 登录 | Passkey 可作为 MFA，也可直接 sign-in；支持按钮/autofill | 无 GoTrue Passkey ceremony | **上游门控**，不保存第二套 credential |
| 组织 MFA | 组织有 `is_mfa_required`；全局有 organization-required prompt policy | 组织/JIT 已有控制面，但没有组织 MFA policy | **上游门控**；必须通过 GoTrue factor、AAL、refresh 回归 |
| Adaptive MFA | 当前源码有新国家、异地速度、长期不活跃、低 bot score 等规则；属于 developer feature | 无等价能力 | P1 研究；风险信号可在 SupaCloud 计算，challenge 仍由 GoTrue 执行 |
| 密码策略 | 长度、字符类型、泄露密码、重复/连续字符、用户信息、自定义词库、可选过期 | GoTrue 最小长度和固定字符策略 | 泄露/弱密码能力 **上游门控**；不建议默认周期过期 |
| Identifier lockout | Sentinel 按目标 hash、动作、失败次数和锁定时间执行；支持管理员解锁 | Security 的 brute-force/max attempts 实际仅保护 SupaOAuth 管理登录 IP | 先修正文案；终端用户 lockout **上游门控** |
| OTP 策略 | verification code expiry 60–3600 秒、最大失败次数 1–100 | 无对应 GoTrue 权威控制台能力 | **上游门控** |
| 邮箱阻止策略 | disposable、subaddressing、custom allow/block；部分 Cloud/付费限定 | 域名 allow/block、OAuth Provider allow/block、invite-only，通过 GoTrue Hook 执行 | 双方侧重点不同；SupaOAuth 当前能力有价值，保留 |
| 登录体验 | 品牌、暗色、CSS、桌面/移动实时预览、Custom UI ZIP 和 CSP | 品牌、内容、CSS、内置页面预览；历史 Custom UI 包只能安全读回和删除，上传与同源 serving 已移除 | 内置预览和安全清理 **现在应加入**；完整页面只在独立 Origin 后重新设计 |
| Custom profile fields | 独立 catalog、顺序、注册与 Account Center 投影 | 已有 `profile_field` 管理和收集页面 | 补预览、字段类型/校验和 runtime read-back，不复制表 |
| Account Center | 字段级 read/edit、Passkey、MFA、session、grant、identity、自定义 CSS/CSP | 已有 profile/email/phone、TOTP、grant、identity、自删等自助 API；session unavailable | 完善 UI 和 capability 展示；session 上游门控 |
| Access Token claims | 用户 token 与 M2M token 分别执行自定义脚本，可读取用户/应用/组织上下文 | 固定 GoTrue Custom Access Token Hook，投影到 `app_metadata.supaoauth.projects[projectRef]` | 增加受限声明式 policy；**不复制任意脚本** |
| ID Token claims | 显式启用 `custom_data`、identities、SSO identities、roles、organizations 等扩展 claims | 没有 ID Token claim 配置 | 只有 GoTrue 提供扩展点时才开放 |
| Actions | 当前 master 有 post-first-factor-verification、post-sign-in 两类脚本；Cloud quota/功能开关，侧栏仍注明 under development | 无任意认证脚本运行时；有固定 GoTrue Hooks | **暂不复制任意 Actions**；优先固定、可审计的 Auth Hook 模板 |
| SAML 应用 | Logto 可作为 SAML IdP，含 metadata、SSO endpoint、证书、NameID、断言加密和 attribute mapping | 支持入站 SAML/OIDC enterprise SSO；明确只作 SP，不作 SAML IdP | **按业务决定**，如做则隔离 sidecar，不改变 GoTrue OIDC |
| Attribute Mapping | 仅 SAML application 和 SAML connector，不是通用 OIDC claim mapping | 入站 enterprise SSO 有 role/org mapping | 不把它误报成通用 JWT 能力；按 SAML 需求建设 |
| CIMD dynamic client | master 最新开发功能；无 app record、租户开关、权限 ceiling，并要求 OIDC SSRF 保护 | 无 | **暂不加入**；等待标准和 GoTrue 上游支持 |
| Organizations / JIT | email domain、SSO connector、JIT roles、应用/M2M 关系、组织 MFA | SupaCloud 权威 organization/RBAC；domain JIT capability-gated，enterprise SSO 有 role mapping | 增强统一可视化和 read-back，不复制 Logto org 表 |
| Webhook | HMAC 签名、固定 3 次重试、10 秒 timeout、请求/响应审计、24h 成功率 | delivery 详情、签名状态、测试、secret rotation、重放、未知结果保护 | **SupaOAuth 更强**；补 24h 成功率、请求数、P95 和连续失败 |
| 审计 | 事件、应用、时间过滤；Webhook 调用写入 Log | actor/resource/time 过滤、cursor、详情、导出、integrity checkpoint | **SupaOAuth 更强**；补 saved views、保留期和异常提示 |
| Cloud 商业能力 | 成员、域名、套餐、计费、invoice、quota、AI/帮助 | 成员 capability、域名、OIDC、Advanced、Diagnostics；无计费 | 自托管不需要；商业 SaaS 时再做 |

## 6. 关键源码发现

### 6.1 Logto 的高级能力依赖它自己的身份数据模型

以下不是“加一个管理页面”就能获得的能力：

- `users.sql` 直接保存密码 hash、identities、`mfa_verifications`、密码过期状态；
- `verification_records.sql` 保存临时验证状态；
- `oidc_session_extensions.sql` 扩展 Logto 自有 OIDC session；
- `personal_access_tokens.sql`、`subject_tokens.sql`、`one_time_tokens.sql` 都是独立 token 权威；
- `application_user_consent_*` 系列表定义 Logto 自己的 scope/organization consent 模型；
- `daily_active_users.sql` 和 `aggregated_daily_active_users.sql` 服务于产品分析和计费；
- `sentinel_activities.sql` 是终端用户认证失败与锁定决策记录。

这些表不能迁入 `supaoauth` schema 来模拟功能，否则会形成第二套 credential、session、grant 或 token source of truth。

### 6.2 Logto 的 session/grant 管理是真实运行时能力

Logto 的 Account API 和 Management API 都能读取 active sessions、销毁指定 session，并可选择撤销相关 grants。管理员还可查看并撤销某个用户的第三方应用 grant。

SupaOAuth 当前实现是正确的 fail-closed：

- 管理员 session list/revoke 返回 `gotrue_admin_user_sessions` unavailable；
- 管理员 identity unlink 返回 `gotrue_admin_identity_unlink` unavailable；
- 管理员 grant revoke 返回 `gotrue_admin_oauth_grants` unavailable；
- 当前用户仍可通过 GoTrue user endpoints 管理自己的 grant 和 linked identity。

建议保留这条边界，不要用直接删库行的方式伪造管理 API。

### 6.3 Logto JWT 自定义比控制台表面能力更深

Logto 的 Access Token customizer 不是静态 claim 开关，而是脚本执行器。脚本上下文可包含用户、MFA factors、roles、organizations、organization roles、应用、交互和 token-exchange context；Cloud 可远程隔离执行，OSS 可用本地 VM。

SupaOAuth 当前页只做三件事：

1. 展示 Supabase required claims 和 runtime roles；
2. 校验 `app_metadata.supaoauth.projects[projectRef]` 的受限 schema；
3. 检查 GoTrue Custom Access Token Hook 是否注册并通过 synthetic verify。

编辑器内容不会保存成租户 claim policy。短期必须改名或明确这一点；中期可以在固定 Hook 中增加受限、声明式、版本化 policy，但不能允许覆盖 `iss`、`aud`、`sub`、`role`、`aal`、`session_id`、`exp`、`iat` 等 Supabase 运行时 claims。

### 6.4 Security 页存在必须澄清的语义

SupaOAuth `security_config.brute_force_protection`、`max_login_attempts`、`lockout_duration_sec` 被 `auth/index.ts` 的管理登录 IP limiter 使用。它们不是 GoTrue 用户密码登录的 identifier lockout。

所以：

- UI 应改成“管理控制台登录保护”，并暴露实际 lockout duration；
- 终端用户登录锁定必须单独显示 capability 状态；
- 只有 GoTrue/SupaCloud 提供权威策略、状态查询和解锁 API 后，才增加 Logto Sentinel 类控制。

### 6.5 Logto Actions 与 CIMD 均不是当前应追赶的稳定基线

- Actions 源码已有两个触发点，但侧栏仍写明 under development，Cloud 还受 quota gate；它允许不可信脚本参与密码验证后或登录后流程，安全与运维成本高。
- CIMD 是 developer feature，依赖 OIDC provider SSRF protection；dynamic client 没有 application row，只使用租户级 permission ceiling。

两项都不应进入 SupAuth P0/P1。SupaOAuth 更适合把固定 GoTrue Auth Hooks 做成安全、可审计、可验证的模板，而不是构建通用代码运行器。

## 7. SupaOAuth 应加入的功能

### P0：不改变 GoTrue/Supabase 合同，下一阶段直接做

#### 7.1 修正产品真相与 capability 模型

- 将“自定义 JWT”改为“JWT Claims 与 Auth Hook”，或明确“编辑仅用于 schema 预览，不会保存为 claim policy”；
- 将 Security 中的 brute-force 区域明确标注为“管理控制台登录保护”；
- 所有依赖上游的页面统一显示：`available`、`source`、`version`、`reason_code`、`last_verified_at`；
- 统一区分 `403`、`404`、`unsupported`、`unavailable`、`empty`，不能把 unsupported 展示成空列表；
- 对 Passkey、admin sessions、admin identity unlink、admin grant revoke、M2M token 明确 fail-closed。

验收：页面不能再把 overlay 配置、预览或角色分配写成 GoTrue 已执行的认证能力。

#### 7.2 身份分析仪表盘

在现有“协议与 Supabase 兼容诊断”下新增“身份分析”：

- 总用户、今日新增、7 日新增；
- DAU、WAU、MAU 和 30 日趋势；
- 登录成功/失败、MFA 覆盖率；
- 按应用、Provider、组织拆分；
- 数据延迟、时区和统计口径说明。

实现原则：由 SupaCloud 服务端从权威 auth/audit/event 数据聚合；浏览器只读取租户隔离后的聚合结果。不要复制 Logto `daily_active_users` 表作为新的登录权威，也不要把原始用户事件整批下发前端。

验收：明确去重键、窗口边界、匿名用户、service/M2M token 是否计入；跨租户查询必须 fail-closed。

#### 7.3 完成安全的登录体验控制台

- 桌面/移动实时预览；
- light/dark 双主题；
- 预览仅渲染内置托管模板的结构化品牌配置；
- 对历史 Custom UI 包只展示脱敏文件清单、hash、阻断原因、审计和删除恢复状态；
- blocked/cleanup-pending/unknown-outcome 状态必须来自权威读回；
- 删除、并发冲突和审计链接继续 fail-closed。

实现原则：认证/Admin 同源上的 Custom UI POST 固定 501，旧资源路由固定 404，
不得恢复已经删除的 ZIP 解析、上传、激活或 serving 链。未来若确需完整页面，必须先
建立独立不可信 Origin、隔离 cookie/CSP/资源合同，并从新的安全边界重新设计，不能
复用旧上传实现。预览不能放宽生产 CSP。

#### 7.4 第三方应用与授权总览

- first-party / third-party 分组；
- client owner/source、public/confidential、redirect URI 风险；
- 请求 scope、授权用户数、最近授权时间、revoked 状态；
- 与应用 consent policy、用户 grant、自助撤销和审计联动；
- 管理员 revoke 按 capability 禁用，不能直接操作 GoTrue 内部表。

#### 7.5 用户安全与访问视图

在用户详情中统一展示：

- linked identities 和来源；
- TOTP factors 与 AAL 能力；
- OAuth grants；
- session capability 状态；
- 最近认证、Provider、应用和组织访问摘要。

自助 grant revoke、identity unlink、TOTP 继续使用 GoTrue user token；管理员操作只在上游 API 可用时出现。

#### 7.6 Webhook 运行概览

在现有强 delivery/replay 能力上增加：

- 24h 成功率与请求数；
- P50/P95 延迟；
- 连续失败次数和最后成功时间；
- 按 endpoint/event 的趋势；
- delivery backlog / unknown outcome 告警。

#### 7.7 Quickstart、帮助和搜索

- Supabase JS、SvelteKit、React、Next.js、server API 五类 quickstart；
- issuer、client ID、redirect URI、PKCE、refresh、logout 验证清单；
- 页面级文档深链、OpenAPI/SDK 入口；
- 全局搜索应用、用户、组织、角色、Webhook 和审计事件；
- 提供只读试用登录和 callback 诊断，不自动创建生产客户端。

### P1：必须 capability-gated，并做完整兼容性验证

#### 7.8 MFA 扩展

依次验证并开放：

1. Passkey/WebAuthn ceremony；
2. Phone MFA、Email MFA；
3. recovery/backup codes；
4. organization required MFA；
5. adaptive/risk-based MFA；
6. factor revoke、AAL upgrade、refresh 和跨设备恢复。

上线前必须证明：factor 状态由 GoTrue 权威持有；JWT `aal` 与 session refresh 正确；Supabase JS enroll/challenge/verify/unenroll 全链路可回归；不存在 SupaOAuth credential store。

#### 7.9 终端用户安全策略

- identifier lockout：阈值、时长、状态查询、审计解锁；
- OTP expiry 和 retry；
- 泄露密码检查；
- 弱短语、用户信息、自定义词库检查；
- 风险事件触发 session revoke/MFA challenge。

这些策略必须位于 GoTrue 密码设置、登录和验证码验证路径，不能只做前端校验或由 Admin BFF 自说成功。

密码过期不应默认启用。只有明确合规要求时才开放，并必须先证明所有用户都具备可用恢复渠道。

#### 7.10 声明式 claim projection

在现有 Custom Access Token Hook 上增加受限 policy：

- 只允许 `app_metadata.supaoauth.projects[projectRef]` 下的声明式映射；
- 固定字段 allowlist、类型、数量和 token size 上限；
- preview、diff、版本、回滚和 synthetic verification；
- 数据源只来自 SupaCloud 权威 RBAC/organization；
- mutation 后读取真实 token 验证，而不是只读回配置。

ID Token claims 和 M2M claims 只有 GoTrue 提供权威扩展点时才开放。

#### 7.11 管理员 session / identity / grant 操作

只在上游提供以下合同时实现：

- 列出 active sessions、设备/时间/IP；
- 按 session ID revoke；
- 选择是否连带 revoke grants；
- 管理员 identity unlink 的防锁死规则；
- 管理员 grant revoke 和权威 read-back。

#### 7.12 真正的 M2M

只有 GoTrue/SupaCloud 提供 `client_credentials`、audience/scope、secret rotation、revocation、JWKS 和 audit 合同后，才把现有 M2M 角色分配升级为 token 能力。SupAuth 不新增 `/token` 替代 issuer。

### P2：按商业和客户需求决定

- SAML IdP application：独立 sidecar，复用 GoTrue 登录，不复用或覆盖 GoTrue token/session；
- CIMD dynamic client：等待标准稳定、上游支持和 SSRF 安全审计；
- 套餐、账单、invoice、usage entitlement；
- AI 助手；
- 多项目产品切换器；
- 更广 connector marketplace。

## 8. 明确不应加入 SupAuth 的 Logto 实现

- `personal_access_tokens` 或自定义 PAT bearer token；
- `subject_tokens` 和 BFF 自行实现 token exchange/impersonation；
- Logto `one_time_tokens` 作为新的认证 token 权威；
- 自建 Passkey credential、backup code、recovery store；
- 自建 OIDC session、grant、refresh token、ID token、JWKS 或 `/token`；
- 任意 JavaScript 直接参与密码验证和登录流程的 Actions 平台；
- 绕过 GoTrue API 直接删除 session、identity、factor 或 grant 数据；
- 为了 Custom UI 或 CIMD 关闭 CSP/SSRF 防护；
- 仅创建菜单或占位页，却没有 capability、权限、审计和权威 read-back。

## 9. GoTrue / Supabase 不可变兼容边界

所有新增能力必须同时满足：

1. `auth.users`、密码、session、refresh token、MFA、JWT/JWKS、OAuth/OIDC 继续由 GoTrue 权威持有；
2. 不改写 `/auth/v1/*` 的路径、请求/响应、cookie、PKCE、refresh、logout 和错误语义；
3. Supabase SDK 的 password、magic link/OTP、OAuth、PKCE、refresh、logout、MFA 行为保持不变；
4. 顶层 JWT `role` 继续是 `anon` / `authenticated` / `service_role`，业务角色不得覆盖；
5. SupAuth 扩展只进入版本化的 `app_metadata.supaoauth.projects[projectRef]`；
6. Admin Console 只调用同源 `/api/v1/*` BFF，不直接持有 SupaCloud 管理密钥；
7. 高风险 mutation 必须有权限、幂等、并发保护、审计、权威 read-back 和回滚；
8. capability unavailable 时 fail-closed，不能本地模拟成功；
9. 新 overlay 表只能保存控制面、策略、聚合和审计数据，不能成为第二认证权威；
10. 生产验收必须包含认证后 read-back，源码、构建成功或 HTTP 200 不能代替运行时证据。

## 10. 分阶段验收建议

### 阶段 A：控制台与产品真相

- 完成 P0 页面和文案；
- 所有 capability 页面覆盖 available/unavailable/forbidden/empty；
- Custom UI 和 claim 页面均有真实 read-back；
- 不新增任何 token、session、credential 表。

### 阶段 B：GoTrue 兼容回归

- Supabase JS：password sign-in、PKCE、refresh、logout；
- OAuth consent、grant 自助撤销；
- TOTP enroll/challenge/verify/unenroll、AAL；
- JWT issuer/audience/signature/required claims；
- RLS、Storage、Realtime、Edge Function claims；
- 旧 session 与 refresh token 在升级后仍可用。

### 阶段 C：上游能力发布门槛

- capability 版本和来源可追踪；
- mutation 有重复请求和并发测试；
- 权威 API read-back 与实际登录 ceremony 一致；
- migration 可回滚，旧租户和无能力租户不受影响；
- 生产环境有 authenticated browser read-back 和一条独立 SDK smoke。

## 11. SupaOAuth 已有优势，应继续强化

- Supabase/GoTrue 兼容性检查、issuer/OIDC/JWKS/route diagnostics；
- 明确保护顶层 Supabase runtime claims；
- Webhook delivery 详情、签名状态、重放、secret rotation、unknown outcome 保护；
- 审计导出、细粒度过滤和 integrity checkpoint；
- SupaCloud organization/RBAC/应用资源的权威 read-back；
- GoTrue user-token 自助 grant revoke、identity linking/unlink 和 TOTP；
- 邮箱域、OAuth Provider 和 invite-only 准入策略；
- Custom UI 历史 manifest/hash 的严格校验、不可执行状态读回、审计与清理队列。

这些能力比复制 Logto token/session 数据模型更符合 SupAuth 的长期定位。

## 12. 关键源码证据

### Logto

- 控制台分组和 Actions gate：`packages/console/src/containers/ConsoleContent/Sidebar/hook.tsx:55-163`
- Application/User/Tenant routes：`packages/console/src/hooks/use-console-routes/routes/`
- 应用类型：`packages/schemas/tables/applications.sql:3-21`
- SAML attribute mapping：`packages/console/src/pages/ApplicationDetails/SamlApplicationDetailsContent/AttributeMapping.tsx`
- CIMD 权限 ceiling：`packages/core/src/routes/cimd.ts:15-159`
- Session 管理：`packages/core/src/routes/account/sessions.ts:22-117`、`routes/admin-user/session.ts:22-107`
- Grant 管理：`packages/core/src/routes/account/grants.ts:19-105`、`routes/admin-user/grants.ts:18-70`
- PAT：`packages/schemas/tables/personal_access_tokens.sql`、`packages/core/src/routes/admin-user/personal-access-token.ts:14-155`
- Token exchange：`packages/core/src/oidc/grants/token-exchange/index.ts:1-256`
- M2M：`packages/core/src/oidc/grants/client-credentials.ts:62-199`
- MFA 类型与策略：`packages/schemas/src/foundations/jsonb-types/sign-in-experience.ts:180-271`
- MFA/用户存储：`packages/schemas/tables/users.sql:5-27`
- 组织/JIT：`packages/schemas/tables/organizations.sql`、`organization_jit_*.sql`
- 密码、Sentinel、OTP 策略：`packages/schemas/src/foundations/jsonb-types/sign-in-experience.ts:286-447`
- Sentinel 执行：`packages/core/src/sentinel/basic-sentinel.ts:126-199`
- JWT customizer：`packages/schemas/src/types/logto-config/jwt-customizer.ts:40-224`
- ID Token claims：`packages/schemas/src/types/logto-config/index.ts:169-176`
- Actions：`packages/schemas/src/types/logto-config/action.ts:16-120`
- Dashboard：`packages/core/src/routes/dashboard.ts:16-167`、`event-listeners/record-active-users.ts:5-18`
- Webhook delivery：`packages/core/src/libraries/hook/utils.ts:32-48`、`libraries/hook/index.ts:45-100`

### SupaOAuth

- 运行时定位和 route composition：`packages/auth-server/src/index.ts:1-144`
- GoTrue/overlay schema 边界：`packages/auth-server/src/db/schema.ts:1-6`
- 导航：`packages/admin-console/src/lib/navigation.js:1-50`
- Dashboard：`packages/admin-console/src/routes/dashboard/+page.svelte:18-164`
- GoTrue grant types：`packages/admin-console/src/lib/oauth-grant-types.js:1-10`、`packages/auth-server/src/routes/applications.ts:14-87`
- Admin session/identity/grant fail-closed：`packages/auth-server/src/routes/users.ts:101-168`
- 用户自助 grant/identity/TOTP：`packages/auth-server/src/routes/account-self-service.ts`
- Passkey fail-closed：`packages/auth-server/src/routes/passkeys.ts:1-23`
- MFA 页面：`packages/admin-console/src/routes/mfa/+page.svelte:13-169`
- Security 页面：`packages/admin-console/src/routes/security/+page.svelte`
- 管理登录 lockout 实现：`packages/auth-server/src/auth/index.ts:202-233`
- JWT/Hook 页面：`packages/admin-console/src/routes/customize-jwt/+page.svelte:1-325`
- Auth Hook：`packages/auth-server/src/routes/auth-hooks.ts`
- Custom UI 历史状态与清理边界：`packages/auth-server/src/routes/sign-in-experience.ts`、`utils/custom-ui-assets.ts`
- Tenant capability tabs：`packages/admin-console/src/routes/tenant-settings/+layout.svelte:10-53`

## 13. 浏览器证据入口

- [Logto 开始上手](https://cloud.logto.io/rmilj6/get-started)
- [Logto 仪表盘](https://cloud.logto.io/rmilj6/dashboard)
- [Logto 登录与账户](https://cloud.logto.io/rmilj6/sign-in-experience)
- [Logto MFA](https://cloud.logto.io/rmilj6/mfa)
- [Logto 安全](https://cloud.logto.io/rmilj6/security/password-policy)
- [Logto 自定义 JWT](https://cloud.logto.io/rmilj6/customize-jwt)
- [Logto Webhooks](https://cloud.logto.io/rmilj6/webhooks)
- [Logto 审计日志](https://cloud.logto.io/rmilj6/audit-logs)
- [Logto 租户设置](https://cloud.logto.io/rmilj6/tenant-settings)

## 14. 本轮修复后的实施状态

### 14.1 已实施

- **Capability 产品真相**：`/v1/capabilities` 为未声明能力补充 fail-closed 状态、权威来源、版本、原因和 `last_verified_at`；上游协商不可用与“未声明”使用不同 reason code，已知能力不得伪造权威来源。Dashboard 和用户详情的 capability 请求与基本数据隔离，失败不会遮住 OAuth、项目或用户资料。
- **GoTrue-only 产品合同**：控制台不重新宣传已移除的认证能力；服务端只保留隐藏、不可用的兼容窗口。共享 `CapabilitiesResponse` 已同步验证时间字段。
- **Security 产品真相与边界**：页面区分 GoTrue 账户/JWT 设置和仅适用于旧版/开发环境 `ADMIN_TOKEN` 的来源 IP 保护，明确其不保护 SSO 或终端用户 identifier；`lockoutDurationSec` 纳入权威读回。`/v1/security-config` 只接受 allowlist 字段、正确类型和有界正整数，不再把任意 body 透传给 Drizzle。
- **JWT 产品真相**：“自定义 JWT”改为“JWT Claims 与 Auth Hook”，编辑器明确是本地 Schema/Claim 预览，不保存为租户任意 Claim Policy；GoTrue Custom Access Token Hook 仍是唯一运行时扩展点。
- **Custom UI 安全降级与控制台**：在独立不可信 Origin 尚未建立前，ZIP 上传固定返回 `501 capability_unavailable`（`custom_ui_isolated_origin_required`），Hosted 页面只使用内置 UI，旧 `/custom-ui/*` 与 `/v1/public/custom-ui/*` 资产入口固定返回 404。Admin Console 在初始化管理员认证前定向注销这两棵旧路径下的同源 Service Worker，并以二次枚举作权威确认；清理失败时暂停认证而不是继续加载凭据。已有资源不会被破坏性删除，而是权威读回为 `blocked_unsafe_origin`；控制台只展示安全状态、文件清单和删除入口，不暴露 Storage object key，也不执行同源预览。删除前先写浏览器持久 mutation lock，未知结果必须权威读回或双确认人工核对后才能解锁；GET 失败、状态不完整或安全存储不可用时 fail-closed。
- **登录品牌预览**：支持桌面/移动、浅色/深色实时预览；保存前不主动请求用户输入的背景 URL。PUT 后必须由权威 GET 完整读回三个受管字段，缺失、非字符串或不匹配均不得显示保存成功。
- **Quickstart**：新增 Supabase JS、SvelteKit、React、Next.js 和服务端 token 验证示例；静态集成指南不再依赖 onboarding 权限请求成功，浏览器示例只使用 publishable/anon key。

### 14.2 仍未实现，继续受 capability 或上游合同约束

- 身份分析聚合、应用第一方/第三方归属、Webhook 运行指标仍等待 SupaCloud 权威聚合 API；控制台不模拟空数据或成功。
- 管理员按 Session ID 撤销、Identity unlink、Grant revoke、真正的 `client_credentials` 和 ID Token 任意 Claims 仍不可用；只有 GoTrue/SupaCloud 发布并声明对应 capability 后才能开放。
- 终端用户 identifier lockout、组织 MFA、恢复码等仍由上游能力决定；SupAuth 不建立第二套凭据、Session、Token 或恢复存储。
- Custom UI 任意 HTML/JavaScript 上传和运行时预览仍未开放；只有独立不可信 Origin、隔离后的 CSP/资源合同和完整回归均落地后才能重新接通，不能仅恢复旧路由。
- 本轮只完成本地实现和验证，没有进行认证后的测试站/生产浏览器验收，也没有发布。
