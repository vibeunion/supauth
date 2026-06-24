# 西谷智灯枢鉴系统配置边界

“西谷智灯枢鉴系统”应作为西谷生产租户的部署配置和品牌呈现，不应成为 SupAuth 开源默认名称或 GoTrue runtime fork。

## 落在 SupAuth 的通用能力

- GoTrue/Supabase Auth 兼容：OAuth/OIDC discovery、JWKS、授权码、refresh token、session、MFA 和 `auth.users` 仍由 GoTrue 负责。
- 产品治理层：Admin Console、hosted pages、account center、Applications、Users、Organizations、RBAC、Audit、Webhooks、Connectors、tenant config 和 compatibility tooling。
- 权限桥接：`app_metadata.supaoauth` 的有界投影、RLS helper、资源/scope/application binding、安装期 RBAC 验证。
- 可配置登录体验：`supaoauth.sign_in_experience`、application-level sign-in override、branding bucket 和 `custom-ui/` 部署目录。
- 审计输出：登录、授权、consent、应用、角色、权限、MFA、webhook 等事件的标准化 envelope 和 facade。

## 通过西谷租户配置实现

- 系统名称、名称含义、口号、登录页介绍和按钮文案，例如“西谷智灯枢鉴系统”“一枢通行，万鉴归一”“进入枢鉴”。
- Logo、favicon、主色、背景、功能介绍卡片、完整自定义登录页资源。
- 西谷角色模板：任务创建者、设备操作员、SOP 编辑员、审计查看员等。
- 西谷资源模型：产线、设备、SOP、检测任务、配方、报表、MES/customer portal API resource 和 scopes。
- AI Agent、自动化流程、设备账号对应的 OAuth client、client secret 生命周期、application binding 和最小权限角色。
- 高危操作策略：哪些操作需要 MFA、审批、二次确认或审计升级。
- 企业目录接入：LDAP/AD/员工系统 connector、JIT 规则、同步字段映射和账号生命周期策略。
- 明御对接：事件投递地址、签名密钥、重放/失败处理策略，以及外部不可篡改存证链。

## 不应这样做

- 不把“西谷智灯枢鉴系统”写入默认源码、默认 README 产品名或通用测试期望。
- 不修改 `/auth/v1/*` 语义来实现业务权限。
- 不把 OAuth response `scope` 当作数据库业务权限；业务权限走 RBAC、application binding、RLS helper 和 Management API lookup。
- 不把 Agent 或设备的万能权限塞进 JWT；应使用 service account / OAuth client + 最小 scope / role / resource binding。
- 不承诺 GoTrue 当前不原生支持的能力已经完整可用，例如 adaptive MFA、step-up authentication、不可篡改证据链、完整 LDAP 双向同步。它们应作为配置或后续平台能力接入，并有独立验收。

## 应用西谷登录页配置

先构建或部署 SupAuth，再把租户配置写入目标环境：

```sh
bun run scripts/apply-sign-in-experience.ts \
  --base-url https://auth.ai.xigu.team \
  --config config/sign-in-experience/xigu-shujian.json \
  --dry-run
```

确认 payload 后，用管理员 Bearer token 执行：

```sh
SUPAUTH_ADMIN_TOKEN=... bun run scripts/apply-sign-in-experience.ts \
  --base-url https://auth.ai.xigu.team \
  --config config/sign-in-experience/xigu-shujian.json
```

默认写入 `/api/v1/sign-in-experience`。如果部署环境直接暴露 Function 路径，可显式传入：

```sh
bun run scripts/apply-sign-in-experience.ts \
  --base-url https://auth.ai.xigu.team \
  --path /v1/sign-in-experience \
  --config config/sign-in-experience/xigu-shujian.json
```

写入后用公开接口确认最终展示：

```sh
curl https://auth.ai.xigu.team/v1/public/sign-in-experience/resolve
```
