# 类型安全与跨端契约

> 状态：2026-09-09 严格规则补充改造已通过本地完整检查、隔离制品校验及限定范围独立复核。当前证据见文末“本轮最终验收”；历史记录不替代本轮结果，也不表示已合并、发布或部署。
> 本轮已安全同步发布提交 `4dd229c` 并保留本地修改；上一轮验收基线为 `7e753ed`。App 评估已刷新到兄弟仓库 `d5ec697`。本文不表示工作区能力已合并、发布或部署。

## JTBD 与边界

当维护者调整认证产品的 API 字段、请求参数或响应形状时，需要让 BFF、管理台和 SDK 尽早发现不兼容，并在运行时拒绝错误数据，避免“代码能编译，但客户端与服务端理解不同”。当其他语言或平台接入时，需要获得可版本化、可验证的协议，而不是复制 TypeScript interface。

目标不是更换应用框架，也不是清除所有 `unknown`。目标是在每个受管边界把不可信数据从 `unknown` 解码成已验证的领域值，并把无法确认的结果明确留为未知。

本期实现：

- 由同一份公共 Schema 派生 TypeScript 类型、运行时校验及对外协议描述，减少 DTO、客户端和文档之间的手工漂移。
- 在具体端点上贯通请求、响应和消费者，提供可复现的编译期负例及运行时正反例。
- 保留既有身份来源、权限控制、传输行为和 API 兼容政策，不以类型迁移改变产品语义。

非目标：

- 不替换 GoTrue，不建立第二套用户、会话、令牌签发或控制面 RBAC 权威。
- 不要求为了类型安全整体迁移 `@supacloud/app`，不把所有安全端点转成命令或导出为工具。
- 不宣称所有平台、所有语言、数据库和上游服务天然共享一套 TypeScript 类型。
- 不在本次文档交付中实施框架迁移、生成多语言 SDK、发布包或部署。

架构约束沿用 [architecture.md](/Users/zhd/workspace/supaoauth/docs/architecture.md:13)：GoTrue 拥有认证运行时，SupaCloud 拥有控制面，SupAuth 提供 Function BFF、产品覆盖层和静态管理台。部署清单与领域框架是不同边界，见该文档的 [App 决策](/Users/zhd/workspace/supaoauth/docs/architecture.md:213)。

## All-End 与 Cross-Language

本文用以下定义限定“全端”，不将其作为无范围的完成声明。

| 维度 | 本文含义 | 必须提供的证明 |
| --- | --- | --- |
| All-end / 跨端 | 在声明支持的端之间贯通契约，例如 Bun Function、浏览器管理台、TypeScript SDK；其他 JS 宿主需单独列入矩阵 | 公共类型可消费，运行时解码有效，目标宿主的构建及传输行为通过验证 |
| Cross-language / 跨语言 | Python、Go、Java 等不直接消费 TS 源码的实现，通过发布协议和测试向量获得一致行为 | 可消费的 OpenAPI/JSON Schema 制品、明确的方言及版本、生成或实现的客户端和对应语言一致性测试 |
| 数据库及上游边界 | SQL/RPC、GoTrue 和 SupaCloud Management API 的返回值与 BFF 公共模型之间的转换 | 真实边界测试、映射校验、授权/事务验证；不能仅依赖 HTTP DTO |

TypeScript 类型导出只覆盖静态消费，不承担运行时解码。能够在浏览器编译，不代表已验证其他 JS 宿主；同样，导出 OpenAPI 不代表某个 Python 或 Go 客户端已经可用。

验收清单必须逐项记录“目标端、具体端点、请求/响应类型、运行时校验、传输测试、制品版本、验证状态”。尚未验证的目标标为待验证，不以一个总的“全端通过”覆盖。

## 单源 Schema 方案

### 契约所有权

以 `@supauth/shared` 为 SupAuth 公共契约的归属包。领域模型采用 Schema 定义，并从 Schema 推导静态类型；不再为同一个公开协议字段维护第二份独立 interface。

这里的“单源”限定在同一协议模型内，不要求数据库表、上游 GoTrue 对象、BFF 投影和页面视图共用一个对象形状。它们拥有不同权威和泄密边界，应以明确的转换和测试衔接。公共 Schema 不得直接复用含内部凭据的上游对象，也不能改变已有的数据所有权。

实际依赖方向：

```text
公共领域 Schema + 端点契约
  -> 推导 TypeScript 类型
  -> BFF 请求解析、响应投影与校验
  -> SDK / 管理台的请求编码、响应解码
  -> 可序列化协议制品 -> 其他语言客户端与一致性测试

数据库 / 上游协议 -> 服务端适配与解码 -> 公共领域模型
```

公共包不得依赖 auth-server 初始化、环境配置、数据库驱动、服务端密钥或装饰器容器。宿主相关逻辑留在各端传输适配器中。

### 实现位置

公共契约、服务端注册表和宿主传输明确分层。源码路径用于定位，验证状态以文末记录为准。

| 位置 | 已实现 | 独立验证边界 |
| --- | --- | --- |
| [shared 入口](/Users/zhd/workspace/supaoauth/packages/shared/src/index.ts:1) | 公共模型、端点、Schema 导出；服务端注册表单列 `@supauth/shared/server` 子入口 | DOM/Worker 声明消费及打包依赖检查，不等于所有宿主真实运行或 npm 发布验收 |
| [schema.ts](/Users/zhd/workspace/supaoauth/packages/shared/src/schema.ts:1) | TypeBox `Type` / `Static`、JSON 值模型和 `decodeSchema`；校验异常使用固定错误 | 验证具体约束、错误脱敏、跨宿主构建和不合法数据拒绝，不以 helper 存在替代端点覆盖 |
| [core.ts](/Users/zhd/workspace/supaoauth/packages/shared/src/core.ts:7) | 领域 Schema 及 `Static` 派生类型；上游内部对象不直接作为公开对象 | 必填、空值、字段暴露与历史默认值有专门回归，不宣称证明所有上游可能值 |
| [sdk-endpoints.ts](/Users/zhd/workspace/supaoauth/packages/shared/src/sdk-endpoints.ts:5) | method、path、input、result、responseKind 同源驱动服务端与客户端 | 真实 route inventory 与导出联合核算，隐藏/退休/协议路由仍在分母 |
| [SDK 契约](/Users/zhd/workspace/supaoauth/packages/sdks/typescript/src/response-contracts.ts:3) | 端点请求与响应解码、状态/非 JSON 分类、无写入自动重放 | 错误参数/字段的编译期负例，实际 transport 正反例与 DOM/Worker 消费测试 |
| [管理台传输](/Users/zhd/workspace/supaoauth/packages/admin-console/src/lib/admin-api.ts:161) | 原认证 fetch、Cookie、刷新/取消、Blob 通道接入端点契约 | JS/Svelte 严格检查及 mocked 浏览器流程，不等于生产会话验收 |

五个托管页面的脚本已移到受检查的 TypeScript 模块，由构建工具注入 HTML。第三方 `@svadmin/core@0.55.0` 的源码类型已可在严格配置下直接通过检查，其新增的 `papaparse` 运行时依赖由 `@types/papaparse` 补齐声明；因此移除了 0.49.0 的固定声明补丁，运行时源码保持不变，未以跳过业务文件或全局关闭检查绕开问题。

### 端点契约

每个纳入迁移范围的端点应描述：

- 稳定的操作标识、HTTP method、path、路径参数、query 和 body。
- 成功状态及对应的响应形状；区分 JSON、无内容、HTML、二进制、流和重定向。
- 错误状态、公开错误体以及兼容要求；不得把领域拒绝、网络故障和解码失败合并成成功的空对象或空权限集合。
- 字段序列化规则与扩展策略，包括必填/可选、缺失/null、枚举、日期时间、数字精度和额外字段。

类型应从具体端点的 Schema 推导。禁止只生成 `body?: unknown` 后宣称输入已类型化，或用自由填写的返回泛型代替结果 decoder。Schema 内允许的未知扩展字段必须有明确用途和边界，不能用全对象 `Any` / `Unknown` 充当领域验证。

### 运行时执行

目标校验顺序：

1. 客户端验证调用参数并按端点协议编码；用户输入错误不得到达写入传输。
2. BFF 独立验证不可信请求，执行既有身份与授权检查，调用服务端业务边界；客户端验证不能替代服务端防护。
3. 数据库及上游返回值经适配器解码和公共字段投影；BFF 验证将序列化的业务响应。
4. SDK 或管理台将网络结果视为未知值，按实际状态和响应种类解码后再交给调用方。

JSON 响应需验证序列化后可观察的协议，不仅验证序列化前的内部对象。原生 `Response` 不能仅依赖框架的 response schema；HTML、文件、流和重定向应检查各自的状态、头、访问控制与内容，不强制转换为 JSON。

写操作的响应解码失败可能发生在服务器已经提交之后。客户端不得因此自动重放写入、清除登录态或返回伪造成功；有权威回执查询时才允许按契约确认，并匹配请求及实体。无法确认时必须保留未知状态。只读确认、幂等和事务能力需要各自证明，不能从类型推导获得。

不能把“校验失败”统一理解为“没有副作用”。签名 hook 保持先鉴签及原有 JIT 顺序，custom-access-token 的部分 claims 拒绝可能发生在一次既有 JIT 之后；RBAC 零/负批次也可能先创建角色及审计。入口参数负例的零写证明、回执失败后的未知结果，以及事务/RLS 证明分别记录，不用类型迁移擅自改变这些历史语义。

### 跨语言协议

对外制品应从同一公共契约导出；OpenAPI 负责描述端点和传输，Schema 描述有效载荷。实现导出前须固定兼容方言、转换规则和工具版本，对不能无损表达的约束显式报错或登记限制，不默默丢弃。

跨语言验收需共同测试以下协议选择：

- 缺失字段与显式 null，未知枚举值和额外字段的处理。
- 日期时间的时区与格式，大整数/高精度数值的 wire 表示；不得为迁移擅自改变既有 `/v1` 格式。
- query、数组、路径参数和内容类型的编码；同一测试向量在支持语言中得到一致请求。
- 成功及错误状态、无内容和非 JSON 响应；生成的类型并不能替代运行时拒绝非法数据。

浏览器和服务端专用 API、TypeScript 特有转换、内部对象方法等不得未经显式映射出现在通用协议里。仅在需要新增语言支持时选择生成器并验证，不把“计划支持”写成“已经支持”。

### 版本与兼容性

遵守 [versioned-api-contract.md](/Users/zhd/workspace/supaoauth/docs/versioned-api-contract.md:1)：`/v1` 兼容变更、破坏性变更登记、OpenAPI hash 与发布制品关联保持一致。

门禁从同源契约导出制品并检查漂移，对输入收紧、必填变化、响应删除、状态或错误体变化进行兼容审查。输出允许增加字段的政策必须与实际 decoder 行为一致。将旧 interface 改为运行时 Schema 可能使历史有效载荷被拒绝，因此必须用兼容样本证明，不以“只改类型”为由跳过。旧文档保持原样，具体更正及双基线机制见 [OpenAPI 更正记录](/Users/zhd/workspace/supaoauth/docs/openapi-contract-review.md)。

`JsonValue` / `JsonObject` 收窄具有 **TypeScript 源码兼容变化**，不能称为零破坏迁移。当前 [JSON 定义](/Users/zhd/workspace/supaoauth/packages/shared/src/schema.ts:6) 只允许递归 JSON 值；[Connector.config](/Users/zhd/workspace/supaoauth/packages/shared/src/core.ts:74)、[PublicPhraseBundle.phrases](/Users/zhd/workspace/supaoauth/packages/shared/src/core.ts:195)、审计及错误 details、[JWT metadata](/Users/zhd/workspace/supaoauth/packages/shared/src/claims.ts:100) 等不再接受任意 `Record<string, unknown>`。即使某个旧值能合法序列化，其旧静态类型也未必可赋值；消费者需要真实解码或明确的 JSON 转换，不能补断言冒充兼容。合法 JSON wire 是否维持、额外字段是否保留、非 JSON 宿主对象是否拒绝，须分别用兼容样本验收。

## SupaCloud App 决策

### 名称与证据范围

用户所称 `apl` 名称尚未确认。探索阶段对本地相关命名检索未找到可确证的 APL 定义；本文暂按 `@supacloud/app` 讨论，不断言其他产品、分支或私有包不存在。

重新读取兄弟仓库提交 `d5ec697285edf4491befd5499807ddb8d33554cf` 的 [app/package.json](/Users/zhd/workspace/supacloud/packages/app/package.json:2)，名称为 `@supacloud/app`、版本 `0.11.0`，`./contracts` 已在该提交中。兄弟仓库只读，提交和版本号不证明 npm 或已部署制品包含相同代码。

### 能力与决策

| 决策 | 当前源码证据 | 采用边界或重新评估条件 |
| --- | --- | --- |
| **avoid：仅为类型安全整体迁移 app** | [生成器](/Users/zhd/workspace/supacloud/packages/compiler/src/generate.ts:1061) 生成路径参数键，但 query 为 `Record<string, unknown>`、body 为 `unknown`，默认返回 `Promise<unknown>`，需调用者提供 decoder；[RouteOptions](/Users/zhd/workspace/supacloud/packages/app/src/decorators.ts:151) 的 schema 为可选声明 | 不能据此获得自动领域类型闭环。迁移还需重新衔接路由、请求上下文、DI、guard、错误及构建；同样要补具体 Schema |
| **adopt：共享契约、显式解码和声明覆盖的设计原则** | 本项目已有 shared/SDK 位置；兄弟仓库 [http_contract.ts](/Users/zhd/workspace/supacloud/packages/app/src/http_contract.ts:1) 也显式区分输入和结果 decoder | 优先沿现有 Elysia + shared + SDK 落地，不意味着新增 app 根包依赖。具体 Schema 和边界覆盖必须由本项目负责 |
| **conditional：独立 RPC 契约包** | [db/src/rpc.ts](/Users/zhd/workspace/supacloud/packages/db/src/rpc.ts:1) 定义 typed registry、参数/结果 decoder 和单次 transport 调用；[公开入口](/Users/zhd/workspace/supacloud/packages/db/src/index.ts:67) 导出相关能力 | `@supacloud/db` 独立于 app，但不是纯类型包。仅在既有 RPC 需求下评估，另验发布版本、包构建、RPC/权限/事务，不能增加浏览器权限 |
| **adopt (pilot)：窄 HTTP/命令契约子入口** | 2026-09-14 已独立下载并核验 npm `@supacloud/contracts@0.3.1`，管理台固定版本并仅导入 `@supacloud/contracts/client`；[试点说明](/Users/zhd/workspace/supaoauth/docs/app-contract-pilot.md) 记录制品指纹、依赖成本与验收范围 | 只替换自定义登录页资源删除的自动写入确认编排。它是独立契约包入口，不迁移路由、DI 或 GoTrue 权威。其他流程是否采用需另验收益 |
| **conditional：独立开发期扫描** | [type-safety.ts](/Users/zhd/workspace/supacloud/packages/compiler/src/type-safety.ts:60) 扫描 TS 源码；[route-contracts.ts](/Users/zhd/workspace/supacloud/packages/compiler/src/route-contracts.ts:3) 检查声明，工作区增强仍写明 `verified: false` | TS 扫描不替代 JS/Svelte、HTTP、数据库或 E2E 验证；路由检查依赖 ApplicationGraph，不为使用该检查先重写全部 Elysia 路由。未提交增强不能算发布能力 |

框架运行时把路由 schema 交给 Elysia，见 [适配代码](/Users/zhd/workspace/supacloud/packages/elysia/src/index.ts:714)；[原生 Response 用例](/Users/zhd/workspace/supacloud/packages/elysia/src/response-validation.test.ts:55) 明确保留透传边界。因此声明 schema 齐全、生成代码没有 any、甚至局部测试通过，都不能单独作为全端类型安全完成标准。

本项目已有独立公共包 [@supauth/shared](/Users/zhd/workspace/supaoauth/packages/shared/package.json:2)，试点继续以它定义业务契约。管理台使用固定版本的 `@supacloud/contracts`，不导入 `@supacloud/app` 框架根入口；该契约包不声明生产依赖。[边界回归](/Users/zhd/workspace/supaoauth/packages/admin-console/scripts/app-contract-boundary.test.ts) 验证发布入口的实际浏览器模块图和管理台导入规则。

只有未来确有跨模块 DI、复杂命令事务/审计治理等独立业务需求，并以局部试点证明收益、兼容性、部署边界及回滚可控，才重新评估完整 app 迁移。不得为了该试点改变 GoTrue 权威、BFF 路径、会话语义或把安全端点暴露为工具。本文没有包体与性能对照证据，不宣称任一框架必然更快。

## 验收标准

以下为持续验收标准，具体已执行结果在文末单独记录。每项证据须绑定稳定提交或明确的工作区快照、目标端点及测试命令。

```gherkin
Feature: 单源契约在声明支持的边界保持一致

  Scenario: 同源变更在发布前暴露漂移
    Given 某端点的输入和输出均由公共 Schema 定义
      And BFF、SDK、管理台及协议制品列入该端点的验收范围
    When 修改必填字段或枚举并运行类型、生成漂移和兼容检查
    Then 不匹配的静态调用或过期制品应使对应门禁失败
      And 无运行时解码的消费路径不得标记为已覆盖

  Scenario: 声明为写前校验的不合法输入不能进入写入
    Given 客户端和 BFF 独立使用该端点的输入契约
      And 该字段属于端点声明的写前校验边界
    When 分别通过客户端调用及直接 HTTP 请求提交非法参数
    Then 客户端负例不发起传输
      And BFF 负例在写入前以约定状态和公开错误拒绝
      And 错误不携带凭据或原始校验异常

  Scenario: 失效回执不能引发重复写入或伪造成功
    Given 写请求可能已经提交且响应缺失或不符合结果契约
    When 客户端处理该结果
    Then 不自动重放写入且不清除会话
      And 只有匹配请求与实体的权威回执才能确认成功
      And 无法确认时明确返回未知结果而不是成功空值

  Scenario: 各类响应保留传输与授权语义
    Given 测试端点覆盖 JSON、无内容、HTML、二进制、流及重定向
      And 管理台具有既有认证刷新、Cookie、超时和取消边界
    When 经真实目标宿主请求这些端点并注入错误响应
    Then 按声明种类验证状态、头、内容和访问控制
      And 原生 JSON Response 被显式验证而其他种类不被强制 JSON 解码
      And 认证、错误及下载行为与兼容基线一致

  Scenario: 跨语言支持以制品和测试向量确认
    Given 已声明支持的语言、固定版本的协议制品及公共正反例向量
    When 各语言客户端执行编码、解码和错误处理测试
    Then 缺失与 null、数字和日期、枚举、扩展字段及状态语义符合协议
      And 客户端及部署制品可追溯到同一协议版本
      And 未运行的语言或宿主仍标记为待验证
```

补充门禁：

- 静态负例验证错误参数、错误字段访问会被拒绝；runtime test 通过不等于类型检查通过。
- 对框架 schema、领域 decoder、原生响应分别建立覆盖清单；允许例外须有责任人、原因和验证方式，不用空 Schema 填满清单。
- 涉及真实数据库、RPC、GoTrue 或控制面的变更，另验权限、事务及兼容性；本地 mock 不代替这些证明。
- 构建制品须验证公共包导出、浏览器无服务端依赖/密钥、Function/Pages 可交付，以及版本化 OpenAPI 一致性。

### 覆盖分母与递归引用

[覆盖器](/Users/zhd/workspace/supaoauth/scripts/type-safety-contract.ts:1) 应联合真实 OpenAPI operation 与 [导出的 route inventory](/Users/zhd/workspace/supaoauth/scripts/export-openapi.ts:6) 核算：hidden、退休、基础设施路由仍在分母；`ALL` 展开为八个受支持 HTTP 方法，具体方法覆盖同路径的 `ALL`。未知方法不得静默丢弃。`operation` 必须透传真实 detail 和 `x-supauth-bindings`，不能只保留 validated 标签。

[根入口](/Users/zhd/workspace/supaoauth/packages/auth-server/src/index.ts:48) 对 CORS OPTIONS、Swagger UI 和文档协议显式分类，只表示其传输边界，不意味着领域 JSON 已验证。这四条路由虽不进入 Swagger 文档，仍须保留 inventory，并验证 OPTIONS 的空 204/CORS 头及 Swagger 的实际 HTML/JSON 行为。不能给缺契约的业务路由统一贴 protocol 标签提高数字。

每个 body、parameter、输入绑定、成功响应与媒体类型应单独检查。嵌套空 Schema、未解析引用和纯引用环均不能计为 covered；具有真实字段、元素和具体叶子的递归节点可以通过，有类型的 JSON metadata 可以嵌入领域对象，但根级泛 `JsonObject` 不能冒充领域模型。分类/声明覆盖率不等于运行时安全覆盖率。

这里的空 Schema 指 `{}` 或不约束字段的任意对象，不包括 `type: object`、零字段且 `additionalProperties: false` 的精确封闭空对象。后者可用于无参数命令，并与明确的 `null` 分支组合。204/205/304 应按无体协议验收；302 若真实返回具体 JSON，则检查该状态的 Schema，不虚构 200。普通 200 的空声明、缺 Schema 的 302 不能因此放行。`$ref`/组合旁的 properties、items 等 Schema 关键字即使省略 `type` 也必须递归检查。

导出验收必须遍历 **公开 OpenAPI 与 inventory** 中的每个引用，证明目标真实存在并可解析。TypeBox 原始 `$id`/裸 `$ref` 不能仅重命名为一个并不存在的 `#/components/schemas/...`；需从真实定义建立共同 registry，规整并检查冲突、缺失与递归可达性。全应用 export 成功退出，只证明文件生成，不证明引用或跨语言客户端可用。

### Identity Integration 门禁

同步基线 `7e753ed` 新增的 [identity workflow](/Users/zhd/workspace/supaoauth/.github/workflows/supacloud-identity.yml:14) 固定上游提交 `66a77caea086bb1282772dd9401bd2adb9c04342`，先构建公共 claims、类型检查跨项目测试，再构建候选 `@supacloud/elysia` 并运行专用 gate。此提交号是本项目 workflow 的配置事实，不是包发布或线上版本证明。

本地命令为 `bun --no-env-file scripts/check-supacloud-identity.ts /path/to/built/supacloud/packages/elysia`。该 [入口](/Users/zhd/workspace/supaoauth/scripts/check-supacloud-identity.ts:5) 在缺少 `dist/index.js` 时失败；普通测试未启用跨项目用例不算通过。验收须记录候选上游提交、构建产物和实际执行结果，不能用任意 dirty 兄弟仓库产物代替固定版本。

按 [identity 契约](/Users/zhd/workspace/supaoauth/docs/supacloud-identity-integration.md:111)，专用门禁使用真实 hook、临时签名、HTTP identity adapter 与 authorization-core，覆盖应用 claims、撤权以及脱敏的 401/403/503。本轮已针对固定上游提交独立构建并运行，5 项测试、105 个断言通过，没有跳过。它不替代真实 GoTrue 签发/刷新、数据库事务/RLS、应用迁移或部署验收，也不要求 SupAuth Function 改用 App 框架。

### 完成声明条件

**仅当声明范围内所有 gates 均已通过，且独立 verifier 确认最终稳定快照后，才可声称该范围“100%”。** 至少包括静态检查、编译期负例、runtime 正反例、完整分母的契约覆盖、OpenAPI 引用与漂移、支持宿主/公共声明消费、兼容性及 identity integration；涉及数据库、真实认证或发布部署的范围，还须满足各自独立门禁。任何失败、跳过、未运行或上游制品待确认项都须明确保留，局部测试、脚本退出成功或 covered/total 相等均不能单独代替完成验收。

## 交付与状态

实现已覆盖共享模型、服务端全部路由分类、SDK、管理台与五个托管页，根检查串联严格类型、跨端消费者、运行时测试、OpenAPI 兼容和页面构建。已修复实际历史默认值回归，不把全部旧文档差异直接豁免。

本地改动未提交、推送、发布或部署。整仓检查、隔离制品检查及各实现范围的独立复验已通过。尚未生成并验证所有非 TypeScript 语言客户端；跨端声明检查不等于所有宿主的实际运行。不能作无范围的“100% 类型安全”承诺。

### 上一轮验证结果

稳定隔离副本：`/tmp/supauth-type-safety-final.w4v8G1`。下列命令在无项目环境文件、无生产凭据的隔离环境执行，构建生成文件只写入该副本。

| 检查 | 实际结果 |
| --- | --- |
| `bun --no-env-file run check` | 2,783 pass，0 fail；严格 TS/JS/Svelte、共享声明及 DOM/Worker 消费者、测试、OpenAPI 双基线、管理台检查与构建均通过 |
| `bun --no-env-file run check:artifact` | Function/Pages 制品构建及校验通过，校验报告 `ok: true`、`errors: []`、`warnings: []`；不等于已安装或部署 |
| 契约清单 | 274/274，包含 54 条隐藏/退休/协议路由；这是声明及分类覆盖率，不是绝对运行时安全证明 |
| OpenAPI | 168 个路径；285 项精确节点更正，保留 74 条原始差异供追溯；两组残余破坏性差异均为 0 |
| 兼容门禁独立负例 | 引用形式的新增必填 body/header、已有 health 响应类型变更均保持标准合法，但 CLI 按不兼容退出 1；未改变当前或冻结文档 |
| 实际 PostgreSQL | 同一副本中 15 个授权/RLS + 4 个账号认领用例通过，0 fail、0 skip；PostgreSQL 18.4、独立临时库、非超级用户 RLS 角色；临时容器已清理 |
| 固定上游 identity | 上游 `66a77caea086bb1282772dd9401bd2adb9c04342`，5 pass、105 断言、0 skip |
| 浏览器 | 桌面及 390px 移动视口的创建用户、错误脱敏、菜单与修改密码流程通过；使用本地 mocked API，不是生产登录验收 |

默认整仓检查仍显示 23 条 skip，来自两个需显式启用的 PostgreSQL 测试组，包含 19 个实际用例和 4 条未命名钩子记录；上表的独立真实数据库运行已执行这 19 个用例，不将其写成“23 个数据库用例通过”。

关键日志：`/tmp/supauth-final-check-r5.log`、`/tmp/supauth-final-artifact-r5.log`、`/tmp/supauth-final-reviewed-tests.log`、`/tmp/supauth-final-identity.log`、`/tmp/supauth-maxwell-postgres.NoaJJX/`。这些是本机证据路径，不是远端 CI、发布、安装或生产验证。

固定上游构建入口为 `/tmp/supauth-identity-66a77ca-dwdVOk/upstream/packages/elysia/dist/index.js`，SHA-256 为 `cb865201040ad9a8f5d36a49758214848ffdc182733317d0d4cf7538525c5356`。工作区原有 `packages/auth-server/src/generated/hosted-pages.ts` 保持 `853fabf8f10ee4f44cefef8471de211528d4493c6464093508a347613f28347f`，隔离构建派生该文件的不同内容属于构建输出，没有覆盖用户文件。

## 严格规则复核

以上通过数字属于上一轮固定副本，不是本轮新规则下的验收结果。补充范围包括显式启用 `noPropertyAccessFromIndexSignature` 和 `skipLibCheck: false`，清除源码和测试中的禁止语法，核算每个实际执行的检查项目，并修复数据库、上游回执和文件读取边界。语法扫描不证明所有隐式 `any` 都已消除，也不能代替领域解码。

根目录 `src/` 是已停用的历史前端；README、拒绝执行的根 Vite 入口及专门测试共同限定这一边界。维护分母包括各 package 的源代码、测试和实际配置，以及根 scripts/tests；不能通过把仍在使用的文件移出检查来提高覆盖率。

### 本轮最终验收

2026-09-09 在无项目环境文件的隔离副本 `/tmp/supauth-strict-final.hXG380/workspace` 完成下列检查。受测源码来自保留本地修改后的 `4dd229c` 工作区，不等同于该 Git 提交本身。运行时代码、配置、测试和锁文件保持冻结；验收后仅更新本文的结果说明。

| 检查 | 本轮实际结果 |
| --- | --- |
| 完整 `check` | 退出 0；3,036 pass、0 fail，包含全部类型、消费者、测试、OpenAPI 和管理台构建门禁 |
| 编译与源码覆盖 | 559 个维护文件，19 个已接线检查项目；严格选项有效，`skipLibCheck: false`，配置/覆盖/禁止语法问题均为 0；原生 Svelte 检查 0 errors / 0 warnings |
| 隐式类型门禁 | 496 个维护 JS/TS 文件的变量、参数、函数及 Promise 返回类型，顶层 `any` 问题 0、未覆盖 0；另有 63 个 Svelte 文件经过正式解析器和原生检查器 |
| 路由契约 | 274/274，包含 54 条隐藏路由；分类覆盖不等于对全部运行时行为的数学证明 |
| `check:artifact` | 退出 0；Function/Pages 实际制品 `ok: true`、`errors: []`、`warnings: []` |
| OpenAPI 读回 | 独立导出与最终制品各自通过完整 typed baseline 和审阅后的 legacy baseline；保留 74 项历史差异和 285 项精确文档更正，没有重写保护基线 |
| 真实临时 PostgreSQL | 授权/RLS 15 项、账号认领 4 项全部通过，0 fail / 0 skip；独占容器清理后按 ID 再次确认不存在 |
| 固定 identity | `66a77caea086bb1282772dd9401bd2adb9c04342` 对应固定构建，5 pass / 0 fail / 0 skip |
| Node 24 | 真实 Node 24.20.0 离线执行及独立 6 场景复核通过；专用声明图不含 Node 26、Bun 或 DOM |
| 输入保护 | 703 项输入在原工作区无漂移；副本仅预期的 hosted-pages 生成输出变化，原工作区受保护文件及 legacy baseline 摘要不变 |

默认检查的 23 条 skip 记录来自两个显式开启的数据库测试组，包含 19 个实际用例及 4 条钩子记录；本轮独立数据库执行已跑完这 19 项，不能把 23 条记录称为 23 个数据库用例。

宿主类型由真实依赖隔离：Bun 采用其匹配的 Node 26 声明，`.github` 是私有 Node 24 工具工作区。没有使用会导致两版声明混入的 Node 类型别名方案。新增的 Elysia、Drizzle、Swagger、auth-js、TanStack 五份补丁均经正负消费者及独立审核，只修正声明、不改对应运行时代码；回归测试随仓库维护。

本轮同时修复密码写入结果未知时的重复尝试、JWKS/discovery 畸形数据误报健康、公开 Auth UI 构造输入未验证、审核合并未绑定提交 SHA，以及测试中的隐式 `any`。OpenAPI 校验适配使用正式字符串入口和受限内存解析器，不再用 `Reflect.apply` 绕过输入声明。

“类型安全”的证明范围仍需明确：语义门禁检查顶层绑定和返回类型，不穷举第三方内部及所有深层泛型；少量本地闭合键集合和已验证品牌断言有逐处不变量审核，不声称零普通断言。未新增跳过声明检查或第三方不安全豁免。浏览器/Worker 消费通过不等于新增 Python、Go、原生移动 SDK 已获验证；本轮未重做完整浏览器 E2E、真实 WebAuthn 仪式或生产登录/部署验收。

主要证据：隔离运行目录下 `evidence/check-final-r2.log`、`artifact-final.log`、`test-summary.json`、`openapi-current.log`、`openapi-artifact.log`、`source-after.json`；独立审查见本仓库 `.agents/state/type-safety-strict-followup/`。历史失败及中断记录保留，没有用局部成功覆盖失败的完整检查。

### pg_graphql

**当前不引入。** SupAuth 的身份操作归 GoTrue，组织和平台权限操作归 SupaCloud 控制面；本地 PostgreSQL 只是产品覆盖层。数据库反射查询不能替代这些受治理操作，直接开放现有表还需要重新证明敏感列、grants、RLS 和函数权限。

未来只有应用自有、关系密集且读多的数据确实存在已测量的查询瓶颈时，才考虑最小只读投影试点。前提是独立调用角色、跨租户拒绝测试、同源 operation 类型与逐字段运行时 decoder、查询成本限制和 schema 漂移检查。GraphQL codegen 的类型本身不验证网络响应。

固定上游与本地源码、官方权限来源、版本证据和完整试点门槛记录于 [pg_graphql 评估](/Users/zhd/workspace/supaoauth/.agents/state/type-safety-strict-followup/explorer-pg-graphql.md)。本轮未启用扩展、连接线上数据库或验证线上 RLS。

### SupaCloud App

**当前不整体迁移到 `@supacloud/app`。** SupaCloud App 部署包与 npm 领域框架是不同层次；现有 Function 部署不依赖 App 的 decorator、DI 或 compiler。当前 shared TypeBox、Elysia 和 SDK 已直接承担本项目的领域契约，改框架不会自动修复其静态或运行时缺口。

截至 2026-09-14，管理台的契约试点已从历史的 `@supacloud/app/contracts` 入口切换为
`@supacloud/contracts@0.3.1` 的 `@supacloud/contracts/client` 入口；这次只替换契约客户端依赖，
不改变 Function、GoTrue 权威、持久锁或领域状态读回规则。下方 2026-09-09 的 `@supacloud/app@0.11.0`
记录保留为历史基线，不代表当前依赖。

上一轮评估分别归档了兄弟仓库 HEAD `d5ec697`、未提交实现和公开发布包，归档中的 registry/compiler 版本仅代表当时的证据，不代表当前最新版本。该轮没有安装 app，消费端声明图也尚未验收；这些是历史评估边界，不是本次试点的当前状态。

2026-09-09 后续试点已固定安装 `@supacloud/app@0.11.0`，只在管理台自定义登录页资源删除流程使用 `@supacloud/app/contracts`。保留现有授权、shared Schema、持久锁和领域状态确认；删除页面内重复的自动编排，不迁移 decorator、DI、compiler 或服务端框架。包含新增依赖和代码的完整 `check:type-safety` 已通过，覆盖 562 个维护文件、19 个检查项目；管理台完整测试 519 项通过，构建、制品与 OpenAPI 兼容门禁通过。浏览器及独立验收的最终状态以 [试点说明](/Users/zhd/workspace/supaoauth/docs/app-contract-pilot.md) 为准，不把上一轮完整测试记录冒充本次全仓测试重跑。

历史能力和发布归档见 [App 评估](/Users/zhd/workspace/supaoauth/.agents/state/type-safety-strict-followup/explorer-supacloud-app.md)；本次验证的是已发布固定版本，不使用上游未提交实现。安装仍引入 Angular/RxJS，窄入口浏览器依赖隔离不等于安装无依赖。
