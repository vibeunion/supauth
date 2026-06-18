---
description: 任务自动化 — 从任务契约领取、执行、提 PR/MR
---
// turbo-all

# Task Automation Workflow

## 0. Pre-Execution Gate
- 优先读取 `progress.md`、`.mailbox/`、`tasks.md` 和 Task Contract
- 若任务来源不明确，先看 Task Contract，再回查 provider 原始任务
- 识别任务相关 skill、项目代码规范、测试约定和提交规范
- 若任务创建、扩展或依赖技术栈、Fullstack Web、数据库或部署目标选择，先补齐 Stack/Fullstack/Database/Deployment Profile、decision source、evidence、required skills 和 verification plan
- 若任务涉及高风险变更、生产环境、权限、密钥，先停下来澄清

## 1. Queue Strategy
- 默认优先级：Task Contract > provider 原始任务 > `tasks.md`
- Provider 只负责任务来源，不决定执行策略
- 当前项目的 Task Ledger / `tasks.md` 是唯一执行源；全局 dashboard 只能提供索引和总览
- 任务由人工或 AI 创建，但必须先标准化为 Task Contract，并写清楚：
  - 目标
  - 非目标
  - 验收标准
  - 相关 skill 和代码规范
  - 若涉及技术栈、Fullstack Web、数据库或部署目标选择：Stack/Fullstack/Database/Deployment Profile、决策来源、证据、非目标和验证计划
  - 影响文件/模块
  - 风险等级与回滚
- 任务状态建议：`ready` → `running` → `review` → `done`

## 2. Delegation Gate（默认启动子代理）

**核心原则：行动型任务必须先做 Delegation Decision；默认主进程（Orchestrator）拆解，子代理执行或独立验证，主进程最终审查和裁决。**

### 调度命令

```bash
# 派发子代理任务
agent-team subagent dispatch <role> "<prompt>" [--model <model>] [--runtime <codex|claude>] [--mailbox <file>]

# 查看可用角色
agent-team subagent list

# 检查运行时可用性
agent-team subagent status
```

### 默认模型映射

| 角色 | 模型 | 用途 | 沙箱 |
|------|------|------|------|
| Orchestrator / Arbiter | `gpt-5.5` | 任务拆解、风险分类、最终裁决、高风险审查、分歧仲裁 | — |
| Executor | `gpt-5.3-codex` | 实现、测试、修复、本地验证、提交准备 | workspace-write |
| Explorer | `gpt-5.3-codex` | 代码探索、根因分析、竞品调研 | read-only |
| Critic | `gpt-5.3-codex` | 计划审查、方案评审 | read-only |
| Verifier | `gpt-5.3-codex` | 完成验证、证据审查 | read-only |

只有安全、数据、生产、不可逆决策或 reviewer 分歧无法收敛时升级到 `gpt-5.5`，并记录 `escalation_reason`。

### 默认执行流程

**完整流水线任务（中/高风险、多文件、多 subsystem、根因不明、不熟悉区域或需要自审的任务）**：

1. **Orchestrator 读取任务** → 形成 Task Contract
2. **Explorer 探索** → `agent-team subagent dispatch explorer "..." --mailbox 0NN-explorer-result.md`
3. **Executor 实现** → `agent-team subagent dispatch executor "..." --mailbox 0NN-executor-result.md`
4. **Verifier 验证** → `agent-team subagent dispatch verifier "..." --mailbox 0NN-verifier-result.md`
5. **Orchestrator 审查所有子代理输出** → 裁决 PASS/FAIL，更新 progress.md 和 tasks.md

**低风险单文件修复**（可跳过 Explorer/Critic，但必须仍有独立 Verifier）：

1. Executor 直接实现
2. Verifier 独立验证
3. Orchestrator 审查

**纯解释/只读/简单命令/格式化/纯文档**（可跳过全部子代理，但必须记录跳过原因）：

1. Orchestrator 直接执行
2. 记录 `safe_skip_reason`

### 必须使用完整子代理流水线的情况

- `risk: medium/high`
- 影响超过一个 subsystem，或预计改动超过 3 个关键文件
- 涉及架构、API 契约、数据模型、状态机、迁移、安全、认证、权限、计费、生产配置
- 需要外部资料核验、竞品/方案调研或多来源事实确认
- 需要审查自己的实现、PR/MR 或完成声明
- 设计质量本身是交付物，应先运行 `/design-review` 或等价 Goal Forge 质证流程
- 不熟悉的代码区域、根因不确定、存在多个实现路径
- UI/运行时行为需要独立视觉或端到端核验
- 任何完成声明需要由当前主进程自我证明时，至少派发 Verifier；不能只用主进程自己的测试输出替代独立验证

### 记录要求

- 使用了子代理：记录角色、范围、收到的证据和最终如何采纳
- 未使用子代理：只允许纯解释/只读/简单命令/格式化/纯文档，记录为什么安全跳过（`safe_skip_reason`）
- 若子代理结论冲突，先通过 `.mailbox/` 或 Task Contract 收敛，不要直接声明完成

### 子代理请求契约

每个子代理 dispatch 必须写清楚：

- `role`：`executor` / `explorer` / `critic` / `verifier`
- `exact scope`：要回答的问题或负责的实现切片
- `read/write ownership`：只读，或允许修改的文件/目录
- `allowed files/directories`：明确边界，避免并行写冲突
- `verification command`：需要运行或复核的命令
- `output schema`：至少包含 `verdict`、`evidence`、`blocking_findings`、`non_blocking_risks`、`recommended_next_action`
- `mailbox persistence`：是否必须写 `.mailbox/`，以及 request/response 文件名

不要为常规实现默认升级到 `gpt-5.5`，也不要创建多个 always-on executor 竞争同一个队列。并行写入只有在文件所有权明确互斥时才允许。

## 3. 循环执行器（Codex 优先）
- 模型优先：`gpt-5.3-codex`
- 在每个项目内串行循环，直到没有 eligible `ready` 任务
- 同一时间只领取并持有 1 个任务，避免并发抢占
- 每完成或阻塞一个任务后，重新读取 `tasks.md`、`progress.md` 和 `.mailbox/` 再决定是否领取下一个
- 先创建独立分支或 worktree，再修改代码
- 实施顺序：
  1. 读取 Task Contract，确认目标和非目标
  2. 加载相关 skill 和项目代码规范
  3. 领取任务并写入 owner / branch / provider 状态
  4. 执行 Delegation Gate；符合完整流水线条件时派发 explorer / executor / verifier，低风险单文件任务至少派发 verifier
  5. 最小实现
  6. 测试 / 类型检查 / 构建
  7. 提交并推送
  8. 创建 PR/MR
- 完成后把任务状态改为 `review`
- 遇到模糊、风险高、缺少验收标准、缺少 skill/代码规范或邮箱冲突的任务，标记 `blocked` 或留下明确说明，然后重新读取 ledger，继续处理下一个 eligible `ready` 任务
- 遇到 Stack/Fullstack/Database/Deployment Profile 缺失、推荐栈与现有项目证据冲突、隐含框架/数据库/托管平台迁移、只写“app/小程序”但目标不清、SSR/SSG/API 所有权不清、桌面/移动/Mpx/数据库/部署运行边界不清时，标记 `blocked` 并要求补齐契约，不要自动套默认栈、默认数据库或默认平台
- 若要让 `automation doctor` 对缺失 subagent evidence 发出强 warning，必须先存在 `.agents/state/tasks.json` 这样的机器可读 task state；不要只靠 Markdown 表格正则推断执行证据。

## 4. 审查移交
- 执行器不自行合并自己的 PR/MR
- PR/MR 描述必须引用 Task Contract，并逐条列出验收证据、使用的 skill 和遵循的代码规范
- PR/MR 描述必须说明 Delegation Gate 结果：使用了哪些子智能体，或为什么安全跳过
- 若发现契约缺失、任务过大或风险上升，改为 `blocked` 并说明原因

## 5. 记录要求
- 每次领取、暂停、完成都要更新 `progress.md`
- 需要协作时通过 `.mailbox/` 留消息
- 非显而易见的决策写进 commit body 的 `Rejected:` / `Constraint:` / `Directive:`
- 任务平台变更时只更新 provider adapter，不改 Task Contract 语义
