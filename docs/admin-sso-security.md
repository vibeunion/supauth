# Admin SSO 安全基线

Admin Console 的生产访问遵循以下边界：

- 每个系统注册独立的 OAuth client。Admin Console 不复用任何业务系统 client；回调 URI 必须是唯一、精确的单个 `/admin` 地址。
- Admin client 是 public client，token endpoint authentication 为 `none`，浏览器只使用 PKCE S256，不保存或发送 client secret。
- 管理员授权使用精确邮箱白名单。域名白名单仅保留迁移兼容字段，不授予 Admin 权限；安装器发现域名条目会 fail closed。
- 服务端始终验证 JWT 签名、issuer、audience、算法和精确邮箱白名单，浏览器不能自行解析 JWT 决定权限。`ADMIN_SSO_REQUIRE_AAL2` 只控制是否额外要求 `aal=aal2`：默认关闭，只有显式设置为 `true` 才开启；空值或 `false` 均不启用 MFA 门禁，其他非空值会阻止 Function 启动。
- MFA、Session、OAuth/OIDC issuer 和 JWKS 仍由 GoTrue 负责；SupAuth 只做 BFF、Admin UI 和安装时的管理面校验。

## 部署前阻断验收

当 `ADMIN_SSO_REQUIRE_AAL2=true` 时，强制策略上线前必须使用真实 GoTrue 流程完成 TOTP challenge/verify，并重新取得 `aal2` access token。验收至少包括：

1. `aal1` 或缺少 `aal` 的有效 token 调用 Admin API 得到结构化 `403/admin_mfa_required`。
2. 完成 MFA 提升后的 token 经 JWKS 验证并带有 `aal2`，精确邮箱管理员可以进入 `/admin`。
3. `aal2` 但不在精确邮箱白名单的账号得到 `403/admin_access_forbidden`。
4. OAuth authorize 请求只有 `code_challenge_method=S256`；token exchange 不带 `client_secret`。
5. 安装器从 SupaCloud Management API 回读 Admin client，确认 public、`none`、精确单回调和 `authorization_code`/`refresh_token` grant。

默认值 `false` 适用于尚未启用管理员 MFA 的环境。准备开启时，在 SupaCloud Function 的服务器环境设置逻辑变量 `ADMIN_SSO_REQUIRE_AAL2=true` 并重新发布 Function；SupaCloud 实际保存为 `EDGEFN_SUPAUTH_ADMIN_SSO_REQUIRE_AAL2=true`。不要使用 `VITE_*`，也不要通过浏览器配置该策略。如果真实 MFA 提升流程尚未验证，不得设置为 `true`。

### Function 运行时变量

SupaCloud 保留 `ADMIN_SSO_*` 和 `SUPAUTH_*` 的项目级名称，安装器不能将它们写入项目 `/secrets`。安装器会把每个 SupAuth 逻辑变量写到 `supauth` Function 的 `/functions/supauth/secrets`，由平台以 `EDGEFN_SUPAUTH_<逻辑变量>` 注入。Function 优先读取该专属变量；若该变量不存在才兼容读取原始变量名，显式空值不会回退。

例如，`ADMIN_SSO_ISSUER`、`ADMIN_SSO_CLIENT_ID` 和 `ADMIN_SSO_REQUIRE_AAL2` 分别映射为 `EDGEFN_SUPAUTH_ADMIN_SSO_ISSUER`、`EDGEFN_SUPAUTH_ADMIN_SSO_CLIENT_ID` 和 `EDGEFN_SUPAUTH_ADMIN_SSO_REQUIRE_AAL2`。`CORS_ORIGINS` 仍是普通项目级变量。

## 受控应急入口

SupaCloud 管理面或受控 SSH 仅作为 GoTrue、Function、路由和 SSO 配置故障时的 break-glass 运维入口：

- 双人授权、限时凭证、全程审计，操作完成立即撤销；只允许回滚 Function/环境变量/网关路由或恢复上一版已验证配置。
- 不把管理员邮箱、token、client secret 写入仓库、日志、浏览器或工单正文。
- 不恢复生产 `ADMIN_TOKEN`，不新增持久化绕过，不从 SSH 直接修改 GoTrue 的用户、Session、MFA 或 OAuth 表。
- 应急入口不能替代真实 AAL2 验收；故障恢复后必须重新执行正常 SSO 登录和安全回读。

生产安装流程和 SupaCloud Function 拓扑见 [`deployment.md`](./deployment.md)。
