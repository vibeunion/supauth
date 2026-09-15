# 真实契约验收

## 目的与边界

严格类型检查验证源码的静态约束。此入口另外验证真实 PostgreSQL、
后端 HTTP、TypeScript SDK 和浏览器中的代表性契约，不能证明全部运行时行为无 bug。
模拟接口测试继续用于边界回归，但不计入这里的真实验收结果。

```sh
bun --no-env-file run scripts/real-contract-acceptance.ts
```

也可以使用 `bun --no-env-file run test:contracts:real`。
不要省略外层 `--no-env-file`，也不要把凭据放进命令行参数。

结果写入 `artifacts/real-contract-acceptance/<run-id>/report.json`。
只有四个唯一阶段全部通过、检查数大于零、源码指纹未变化时才返回零。
配置缺失、未运行、跳过、未知写结果、清理失败均不能产生整体 PASS。
结果包含本地源码指纹，不把它当作远端部署版本证明。

## PostgreSQL

运行器仅使用本机 OrbStack 的 Unix socket、已缓存且固定摘要的 PostgreSQL
镜像。每次创建独占容器、随机数据库、随机密码、loopback 端口和临时内存数据目录。
数据库身份与容器 ID、运行标签、镜像、挂载和端口经核验后才执行 SQL。
不会接收或复用外部 `DATABASE_URL`，也不会清理任何预先存在的容器。

检查包括：

- 现有授权生成器的 15 个真实 RLS 用例。
- 实际 hosted SQL 迁移、数据库目录、约束拒绝、Drizzle 仓储读写与事务回滚。
- 只清理本次分配的容器，并确认删除结果；清理失败保留恢复信息。

这一阶段不是 GoTrue 签发令牌的验证，也不是 SupaCloud Management API
交付迁移的验证。它使用独立临时数据库，不代表部署后端所连接的数据库已经验收。

单独诊断数据库阶段：

```sh
bun --no-env-file run scripts/real-contract-postgres.ts
```

## 后端、SDK 与浏览器

运行前须由环境负责人准备真实隔离项目、对应后端、GoTrue 和管理台。
本入口不会自动部署、改共享认证设置、授予管理员权限或重置 MFA。
以下变量必须通过受控进程环境注入，不能写入测试报告或公共日志：

| 变量 | 要求 |
| --- | --- |
| `REAL_ACCEPTANCE_ENVIRONMENT` | 固定为 `isolated-test` |
| `REAL_ACCEPTANCE_PROJECT_REF` | 平台分配的 20 位小写字母项目编号，必须绑定本轮分配记录 |
| `REAL_ACCEPTANCE_CONFIRM_PROJECT` | 与专用项目标识完全一致 |
| `REAL_ACCEPTANCE_ALLOCATION_JOURNAL` | 本轮私有分配目录的绝对路径，含创建前清单、意图、回执及权威读回 |
| `REAL_ACCEPTANCE_BASE_URL` | 分配记录中的应用 origin 加 `/api` |
| `REAL_ACCEPTANCE_RUNTIME_URL` | 已核验身份中心的 `https://auth.xai.xigu.team/auth/v1` |
| `REAL_ACCEPTANCE_ADMIN_TOKEN` | 该项目的专用管理员凭据 |
| `REAL_ACCEPTANCE_USER_TOKEN` | 该项目的真实非管理员凭据，不能与管理员凭据相同 |
| `REAL_ACCEPTANCE_BROWSER_EMAIL` | 专用浏览器测试账号，已配置真实 SSO 管理权限 |
| `REAL_ACCEPTANCE_BROWSER_PASSWORD` | 测试账号密码，仅在运行进程中使用 |
| `REAL_ACCEPTANCE_BROWSER_CHANNEL` | 可省略；使用已安装系统 Chrome 时只接受 `chrome` |
| `REAL_ACCEPTANCE_BROWSER_IDENTITY_RECEIPT` | 私有身份回执 JSON 的绝对路径，文件权限 `0600` |
| `REAL_ACCEPTANCE_BROWSER_USER_ID` | 本轮临时管理员用户 ID，与创建、读回及真实会话一致 |
| `REAL_ACCEPTANCE_BROWSER_MFA_FACTOR_ID` | 该用户已验证的本轮 TOTP factor ID |
| `REAL_ACCEPTANCE_BROWSER_MFA_SECRET` | 对应 TOTP 密钥，仅通过受控环境注入 |

URL 禁止嵌入凭据、查询参数、fragment 或模糊编码。远程仅允许 HTTPS，
HTTP 仅限明确 loopback。真实项目读回必须匹配目标，健康接口 200 本身不算通过。
环境声明和命名约束不能替代环境负责人对项目归属、权限和部署身份的确认。

后端检查成功响应、匿名拒绝、非管理员拒绝及共享运行时 schema。
SDK 使用真实网络，对本轮唯一 Webhook 执行创建、读取、更新、删除与独立读回。
Webhook 初始为 disabled、事件列表为空，不发送 test/replay 请求。
创建回执未知时只做归属查证，不重放创建；清理只允许精确匹配的本轮资源。

浏览器使用独立空上下文和真实 SSO，不注入伪造会话、不模拟业务响应。
真实远端只允许分配记录绑定的应用和身份中心两个精确 origin；应用业务写入
只允许本轮 Webhook，身份中心写入限定为正常认证、授权及已核验 factor 的
challenge/verify。身份回执必须绑定本轮意图、创建前空匹配、创建回执和读回，
其结构由 `BrowserIdentityReceiptSchema` 定义，不能用环境声明代替。
浏览器操作本轮 Webhook 后由 SDK 独立确认状态，并正常输入 TOTP。
认证写入使用一次性许可，校验具体用户、客户端、回调、授权结果和 PKCE；
当前代表性流程不覆盖自动续期，默认拒绝 refresh-token 写入。
MFA、实际跨域许可、分页或浏览器能力不满足当前入口约束时应阻断，
不得关闭真实安全要求来获取通过结果。浏览器依赖固定版本 Playwright，
缺少可用浏览器时报告未通过，不自动下载或复用用户的登录配置。

旧的 `supauth_contract_` 加 32 位随机标识仅用于同源 loopback 本地夹具，
不能再用于远端测试，也不能绕过分配证据检查。

## 测试项目分配

`scripts/real-contract-deploy.ts` 当前只提供 `allocate` 和 `bind` 两个操作，
不是完整部署器。它核对测试主机身份及当前用户持有的精确 SSH 隧道，
通过管理 API 单次创建新项目并等待权威状态 `ACTIVE_HEALTHY`。
`/health` 返回 200 或 `healthy` 不能覆盖项目状态失败。

运行前必须明确授权新测试项目，并建立本地 `127.0.0.1:29190` 到测试主机
`root@192.168.200.112` 的 `127.0.0.1:9090` 隧道；工具会拒绝其他目的地。
本工具不启动隧道，不读取或修改生产环境，不在命令行传递凭据。

```sh
bun --no-env-file run scripts/real-contract-deploy.ts allocate <本轮 UUIDv4>
```

分配记录保存在 `artifacts/real-contract-deployment/<本轮 UUIDv4>/`。
本次创建结果不明确时，禁止再次执行 `allocate`。`bind` 只恢复已经收到
有效创建回执的就绪读回；未知创建结果须通过分配模块的显式 `reconcile`
能力和完整清单进行人工编排，当前 CLI 没有自动恢复入口。
平台自动回滚任务成功也不等于资源全部清理，须独立读回实际残留。

共享身份中心的临时用户、客户端、MFA 与会话需要单独明确授权。
分配工具不会自动调整共享 PostgreSQL 访问规则、身份中心 CORS 或认证策略。

## 发布门禁

`release:gate` 的 live 模式要求此新增验收通过。
原有 OAuth/MFA、Storage、Realtime 兼容覆盖仍是发布要求，不能被本入口替代。
现有旧入口涉及共享配置、外部指定账号和未完备的清理逻辑，因此暂不自动执行：
即使新增四阶段通过，发布仍以
`LEGACY_COMPAT_FIXTURE_OWNERSHIP_REQUIRED` 阻断，
直到旧套件补齐 run-owned fixture、会话准备、未知结果恢复与清理验收。
这是一项明确的未完成发布条件，不是可通过环境开关绕过的已完成验证。

静态发布检查使用环境白名单，并拒绝存在可自动加载 dotenv 文件的工作副本。
原因是嵌套 package 脚本启动的新 Bun 进程不会自动继承父进程的
`--no-env-file`。请使用不含这些配置文件的隔离发布工作副本，不要删除当前开发配置。

## 尚需单独验收

- 已部署制品、Function 激活版本与本轮源码的对应关系。
- 真实部署数据库的迁移目录和 Management API 安装交付。
- GoTrue OAuth、MFA、Storage、Realtime 的安全临时 fixture 全链路。
- 未纳入代表性场景的其他业务功能、SDK 运行平台和跨端组合。

不能将这里的局部 PASS、制品构建通过或旧模拟浏览器结果描述为“100% 类型安全已全部验收”。
