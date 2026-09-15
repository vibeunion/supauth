# OpenAPI 契约文档更正记录

本次类型迁移以 `7e753ed0b0dee57d39e19157b926cdd85c0ebc3f` 的实际处理器作为历史行为证据，不将它冒充线上已部署版本。

旧文件 `tests/fixtures/openapi-gotrue-only-baseline.json` 保持原样，SHA-256 为 `c473ad0dda0c83d2f527a26fb4147c631537d286ac64ca883826494e42dbcc01`。旧导出只为少数接口声明请求体，响应大量为 `{}`，连 OpenAPI 必需的 `description` 也缺失。因此新增运行时 Schema 后，结构差异不能直接等同于业务兼容性结论。

## 更正机制

- `tests/fixtures/openapi-document-corrections.json` 列出每个批准的 JSON Pointer、修改前后节点的存在性与摘要、理由、历史源码及回归测试路径。
- `tests/fixtures/openapi-typed-baseline.json.gz` 是固定的完整类型化文档。压缩仅用于减小体积；解压后的完整 UTF-8 字节摘要也绑定在记录中，不在检查时从当前导出自动更新。
- 检查在内存中把批准节点应用于旧文档，保留原始差异，再分别比较“更正后的旧文档”和“固定完整类型化文档”与当前导出。任一比较发现未获更正覆盖的破坏性差异就失败；合法增量仍按 additive 政策允许。
- 旧文档只作为有固定摘要的历史输入。更正后的文档、完整类型化文档、当前导出均必须通过标准及内部引用校验；不能用一份本身非法的新基线掩盖问题。
- 禁止根节点、整个路径、整个操作、安全策略替换，以及重复、重叠、过期、无变化节点和参数数组空洞。缺失的源文件或测试证据也使门禁失败。

门禁不提供“接受当前全部变化”选项。未来契约变更需要重新审查具体节点、协议版本与消费者，不应把重新导出基线当作修复。

## 历史行为与更正范围

| 范围 | 历史证据与处理 |
| --- | --- |
| 通用参数 | 本轮新增的 opaque ID 非空/非点限制已恢复为旧服务端 string 域。SDK/管理台仍拒绝空路径段和点路径段，并进行编码。不是通过记录豁免新增的服务端限制。 |
| 存储路径、图片 MIME | 旧处理器已有 bucket、asset type 白名单及图片 MIME 检查；只补全对应参数声明，保留原上传规则。 |
| 登出与签名 hook | scope 原本无默认值；Standard Webhooks 原本要求三个签名头。签名仍先验证原始字节，不能因为补全 body 声明就提前解析并改变签名语义。 |
| 公共账号、用户与模板 | 原处理器已有对象/必需业务字段验证。另行修复 suspend 无 body、MFA challenge 别名、导入非数组默认、同步默认 active；TOTP enroll 无 body 仍可用。 |
| 应用、资源、配置 | 原 handler/仓储需要对象；资源更新无 body 是已证明的例外，已恢复。OAuth type 扩展、consent null 默认、scope description 清空、factory/SSO null 默认、SIE null 容器均按旧行为保留。 |
| 角色、组织与协作者 | 对象校验、赋权目标约束保持。协作者 trim/lowercase/空 status 归一化已恢复。branding/permission 请求已由下述固定上游源码确认，不用返回成功的 mock 代替上游证据。 |
| 运维接口 | RLS/API version/provisioning 无 body 原本不是成功默认；compiler 无 body、RBAC/audit null、compiler 缺字段 warning、API version 旧字符串域均已恢复。 |
| 租户配置 type/key | type 的十类白名单早已存在；key 的多个 anyOf 分支都是同一个 string 域。声明更正不改变实际取值范围。 |
| 应用更新 minProperties | 旧文档写了 1，但旧对象校验允许 `{}`。删除的是文档虚构的约束，不新增运行时非空要求。 |
| 六个非 200 状态 | connector authorize 和两个 SSO authorize 别名早已返回 302；webhook test/replay 早已返回 202；custom-ui-assets 早已固定返回 501。移除旧生成器的伪 200 并登记真实状态，不新增假成功分支。 |
| 空响应 description | 对仍存在的旧 `{}` 响应，只补必需的说明元数据，不在该节点更正中替换整个响应 Schema。新响应内容由完整类型化快照单独保护。 |
| 递归 JSON 定义 | 新 Schema 引用的 `SupAuthJsonValue` 有具体递归定义；不允许悬空引用，也不以任意宿主对象替代 JSON wire 值。 |

各操作的精确范围以逐 Pointer 记录为准。表格不是按路径前缀放行的规则，也不授权忽略未来新增的限制。

### 两项上游请求要求

只读检查 SupaCloud 提交 `d5ec697285edf4491befd5499807ddb8d33554cf` 的以下四个文件，检查时均与该提交一致：

- `packages/management-api/src/routes/project-organizations.ts`：branding 路由要求对象 body，缺失/null 在服务调用前被拒绝。
- `packages/management-api/src/services/project-organization.service.ts`：内部 update 的可选 branding 字段，不等于公开 branding 路由允许无 body。
- `packages/management-api/src/routes/project-rbac.ts`：创建权限需要含 `name: string` 的对象；scope ID 别名不是 name 的替代项。
- `packages/management-api/src/services/project-rbac.service.ts`：真实 createPermission 对缺失/空白 name 在获取配置锁前拒绝，不从 scope ID 推导 name。

固定旧 SupAuth adapter 方法与实际上游路由的离线对照为 3 项测试、42 个断言：branding 缺失/null、permission 缺失/null/空对象/仅 scope ID 均在服务前失败。有效输入对照在服务或锁边界主动抛错，只证明到达与转发，不伪造成功持久化。没有数据库或网络写入。

仓库内 `packages/auth-server/src/__tests__/upstream-required-input.test.ts` 永久保留对应 BFF 拒绝及零转发/零审计回归，正常输入仅验证一次转发到主动失败的边界。它不依赖兄弟仓库，也不冒充对未来上游版本的动态验证。此前失败发生在上游、现在较早在 BFF 拒绝，错误位置/状态未必逐字相同；此证据确认的是没有删除一个原本成功的无 body/name 请求。

## 验证边界

类型化导出固定为 OpenAPI 3.0.3。转换器仅在真实 Schema 位置转换 TypeBox 的 `const`、null、全字符串键 Record 等表示；无法安全表达的形状失败。运行时 Schema 不被转换器修改。标准校验器禁用网络和文件引用解析，普通 example/default JSON 中的 `$ref` 不得被当成引用执行。

兼容回归包含实际本地路由与固定历史函数的离线对照，以及 SDK/管理台的请求与响应负例。它们不代表已完成真实数据库、GoTrue 签发、生产身份、跨语言 SDK 或部署验收。TypeScript 从任意对象收紧为递归 JSON 的源码兼容变化也不能被这份 HTTP 文档更正记录隐藏。
