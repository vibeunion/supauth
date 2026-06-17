---
description: PR/MR 审查合并 — 基于任务契约审查并合并安全变更
---
// turbo-all

# PR/MR Review and Merge Workflow

## 0. Pre-Execution Gate
- 只处理已经进入 `review` 的 PR/MR
- 先读取 Task Contract，再读取 diff 和 CI 状态
- 若 CI 未完成，先等待或重新检查
- 若 PR/MR 涉及认证、权限、数据迁移、生产配置，默认不自动合并

## 1. Contract-aware Review
- 目标是否逐条满足 Task Contract
- 非目标是否被尊重，是否存在范围膨胀
- 验收标准是否有测试、类型检查、构建或运行证据
- 是否识别并遵守相关 skill、项目代码规范和测试约定
- diff 是否最小且可读
- 风险等级是否准确，是否需要人工确认
- 是否存在回滚困难、兼容性问题或安全风险

## 2. Independent Review Gate
以下情况必须使用独立 verifier/critic 子智能体，或留下等价的独立审查证据：
- `risk: medium/high`
- 审查者也是实现者，或 PR/MR 是当前会话刚完成的工作
- 缺少新鲜测试、构建、类型检查、截图、运行日志等验收证据
- 涉及认证、权限、数据迁移、生产配置、安全、计费或不可逆变更
- diff 范围大、跨多个 subsystem，或回滚路径不明确

若跳过独立审查，必须在 review 摘要中说明原因。若独立审查和主审查结论冲突，先退回或升级，不要自动合并。

模型升级规则：`gpt-5.5` 只用于高风险审查、生产/安全/数据/不可逆变更、或 reviewer 分歧仲裁。升级时必须写明 `escalation_reason`、触发条件和已有证据；普通 low/medium 审查默认使用 `gpt-5.3-codex` verifier/critic。

## 3. Task-specific Review Focus
- 配置变更：重点查默认值、环境变量、回滚路径和生产兼容性
- API 变更：重点查请求/响应兼容、错误处理和调用方影响
- UI 变更：重点查关键流程、响应式布局和截图证据
- 数据迁移：重点查备份、幂等、回滚和数据完整性
- 文档/规则变更：重点查后续执行者是否能无歧义操作
- 技术栈变更：重点查是否加载对应 skill，并符合项目既有代码风格

## 4. Review Policy
- `risk: low` 且检查全绿：可自动合并
- `risk: medium`：审查通过后可合并，但必须留下审查摘要
- `risk: high`：只评论，不自动合并，等人工确认
- 多个 PR/MR 同时可合并时，按风险从低到高处理
- 审查不合格优先退回到原 PR/MR，要求原作者修复后继续审查
- 只有当原 PR/MR 无法继续，或者问题已经合并入主线，才新增修复任务
- 新增修复任务必须包含 parent / source / reason，避免任务泛滥

## 5. Merge Output
- 合并后更新任务状态为 `done`
- 在 `progress.md` 记录合并结果
- 必要时在 `.mailbox/` 广播结果
- 若退回，说明缺失的契约项或验证证据
- 若退回是因为 skill 或代码规范缺失，明确指出应加载的 skill 或应遵循的规范
- 若退回需要派生修复任务，必须在 Task Contract 中引用原 PR/MR 和原任务，并说明为什么不能继续原 PR/MR
- 若审查依赖子智能体，摘要必须引用子智能体 response 或 `.mailbox/` 证据；若缺失证据且任务为中/高风险，应退回补证据或升级，不要直接合并。
