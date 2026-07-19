# 西谷智灯枢鉴系统配置边界

“西谷智灯枢鉴系统”应作为西谷生产租户的部署配置和品牌呈现，不应成为 SupAuth 开源默认名称或 GoTrue runtime fork。

## 落在 SupAuth 的通用能力

- GoTrue/Supabase Auth 兼容：OAuth/OIDC discovery、JWKS、授权码、refresh token、session、MFA 和 `auth.users` 仍由 GoTrue 负责。
- 产品治理层：Admin Console、hosted pages、account center、Applications、Users、Organizations、RBAC、Audit、Webhooks、Connectors、tenant config 和 compatibility tooling。
- 权限桥接：schema v2 `app_metadata.supaoauth.projects[projectRef]` 的有界投影、RLS helper、资源/scope/application binding、安装期 RBAC 验证。
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

确认 payload 后，用管理员 Bearer token 执行。`SUPAUTH_ADMIN_TOKEN` 表示要放入 `Authorization: Bearer ...` 的管理会话 token，**不是**服务端配置的原始 `ADMIN_TOKEN`：

- 开发模式：先用原始 `ADMIN_TOKEN` 调用 `POST /api/v1/auth/login`，再使用响应中由当前 Function 实例管理的 session token。
- 生产模式：使用通过管理端 SSO 登录获得、且能被配置 issuer/JWKS 验证的 access token。生产环境不接受原始 `ADMIN_TOKEN` 换票。

开发环境可用下列方式在当前 shell 中换取 session token。先通过安全的 secret source 把原始 token 注入当前进程环境；不要在命令历史里直接写 token。该示例不回显或持久化两种 token，执行前请确保未开启 shell trace：

```sh
set +x
: "${ADMIN_TOKEN:?Inject ADMIN_TOKEN through a secure secret source first}"
SUPAUTH_ADMIN_TOKEN="$(
  bun -e '
    const baseUrl = process.argv[1].replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: process.env.ADMIN_TOKEN }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success || typeof body.token !== "string") {
      throw new Error(body?.error?.message || `Admin login failed with HTTP ${response.status}`);
    }
    process.stdout.write(body.token);
  ' https://auth.ai.xigu.team
)"
export SUPAUTH_ADMIN_TOKEN
```

不要把两种 token 写入 `.env`、shell profile、部署日志或提交到仓库。当前 shell 操作完成后应执行 `unset ADMIN_TOKEN SUPAUTH_ADMIN_TOKEN`。

```sh
bun run scripts/apply-sign-in-experience.ts \
  --base-url https://auth.ai.xigu.team \
  --config config/sign-in-experience/xigu-shujian.json
```

工具会把登录页 overlay 写入 `/api/v1/sign-in-experience`，并把 preset 中 GoTrue `auth-config` 可精确表达的安全字段同步到 `/api/v1/auth-config`：`sign_up_enabled` 映射为 `enable_signup` / `disable_signup`，`password_policy.min_length` 映射为 `password_min_length`，四项密码字符要求映射为 `password_required_characters`。无法精确映射的组合会在写入前被拒绝。`sign_in_methods` 只声明 GoTrue 已支持的登录方式；当前 preset 只声明密码登录，企业 SSO 必须通过已启用的 GoTrue/SupaCloud connector 接入。MFA 只使用 GoTrue TOTP 与真实 AAL，不写入无法生效的 overlay 强制开关。

如果部署环境直接暴露 Function 路径，可显式传入 overlay 路径；工具会从该路径派生同前缀的 `/v1/auth-config`。直连示例也必须复用已换取的 `SUPAUTH_ADMIN_TOKEN`：

```sh
bun run scripts/apply-sign-in-experience.ts \
  --base-url https://auth.ai.xigu.team \
  --path /v1/sign-in-experience \
  --config config/sign-in-experience/xigu-shujian.json
```

写入成功不等于 runtime 已生效。必须检查工具返回的 overlay 与 `auth-config` read-back，再用公开解析接口确认最终展示：

```sh
curl https://auth.ai.xigu.team/v1/public/sign-in-experience/resolve
```

对注册开关等 GoTrue runtime 安全项，还应将 `/api/v1/auth-config` 的已认证 read-back 与真实 `/auth/v1/settings` 结果交叉验证，不能只看登录页是否隐藏注册入口。
