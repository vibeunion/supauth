---
description: 任务自动化 — 从任务契约领取、执行、提 PR/MR
---
// turbo-all

# Task Automation Workflow

## 0. Pre-Execution Gate
- coordination DB v2 项目优先读取 `agent-team context . --task <id>`、DB-backed Task Contract、recent events 和 pending/conflict mailbox 队列；legacy 项目才读取 `progress.md`、`.mailbox/`、`tasks.md` 和 Task Contract
- 若任务来源不明确，先看 Task Contract，再回查 provider 原始任务
- 识别任务相关 skill、项目代码规范、测试约定和提交规范
- 先看 skill 元数据和索引，命中后再渐进加载完整 `SKILL.md` 与必要引用；若用户或契约显式指定 `/skill-name`，只对本轮激活该 skill
- 若任务创建、扩展或依赖技术栈、Fullstack Web、数据库或部署目标选择，先补齐 Stack/Fullstack/Database/Deployment Profile、decision source、evidence、required skills 和 verification plan
- 若任务涉及高风险变更、生产环境、权限、密钥，先停下来澄清

## 1. Queue Strategy
- 默认优先级：Task Contract > provider 原始任务 > coordination DB / legacy `tasks.md`
- Provider 只负责任务来源，不决定执行策略
- coordination DB v2 项目的 `.agents/state/coordination.db` 是唯一执行源；legacy 项目的 Task Ledger / `tasks.md` 是唯一执行源；全局 dashboard 只能提供索引和总览
- 任务由人工或 AI 创建，但必须先标准化为 Task Contract，并写清楚：
  - 目标
  - 非目标
  - 验收标准
  - `collaboration.mode`；`agent-team automation orchestrate --json` 会展开为 `collaboration_plan`，用于说明拓扑、并行策略、角色 lane、证据策略和 warning
  - 相关 skill 和代码规范
  - 若涉及技术栈、Fullstack Web、数据库或部署目标选择：Stack/Fullstack/Database/Deployment Profile、决策来源、证据、非目标和验证计划
  - 影响文件/模块
  - 风险等级与回滚
  - Matter 交付字段：brief、owner、deliverables、acceptance、current_stage、decision_log、handoff_artifacts、final_verdict
  - Taste 反馈字段：scope、verdict、reason、source、permission_boundary
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
agent-team subagent status --json  # 机器可读 runtime 能力矩阵

# 查看可查询的 AgentCard / runtime 能力档案
agent-team agent list . --json
```

### 默认模型映射

| 角色 | 模型 | 用途 | 沙箱 |
|------|------|------|------|
| Orchestrator / Arbiter | `gpt-5.5` 升级标记 / 高风险候选链 | 任务拆解、风险分类、最终裁决、高风险审查、分歧仲裁 | — |
| Executor | 低风险候选链（默认 `gpt-5.3-codex-spark`，回退候选 `gpt-5.3-codex` / `sonnet` / `gemini-3-flash-agent`） | 实现、测试、修复、本地验证、提交准备 | workspace-write |
| Explorer | 低风险候选链 | 代码探索、根因分析、竞品调研 | read-only |
| Critic | 低风险候选链 | 计划审查、方案评审 | read-only |
| Verifier | 低风险候选链 | 完成验证、证据审查 | read-only |

低风险执行层优先使用 Codex/GPT 系列和 Claude Sonnet；`gemini-3-flash-agent` 只适合低风险、可重试的短任务兜底。国产模型默认不拆低风险专用型号，`glm` profile 会让常规执行和高风险裁决都使用 `glm-5.2`，但仍可通过 `--model`、`AGENT_TEAM_<ROLE>_MODEL(S)`、`AGENT_TEAM_LOW_RISK_MODELS` / `AGENT_TEAM_ROUTINE_MODELS` 或项目级 `models.routine_subagent_candidates` / `models.<role>_candidates` 覆盖。只有安全、数据、生产、不可逆决策或 reviewer 分歧无法收敛时才标记 `needs_model: gpt-5.5`，并记录 `escalation_reason`。`gpt-5.5` 是默认升级标记和兜底；实际运行模型可通过 `--model`、项目级 `.agents/agent-team.config.json`、`AGENT_TEAM_HIGH_RISK_MODEL` / `AGENT_TEAM_HIGH_RISK_MODELS` 或 `AGENT_TEAM_ARBITER_MODEL` / `AGENT_TEAM_ARBITER_MODELS` 覆盖，候选链会识别国产模型族以及 Codex/OpenAI、Claude Code、Zed/第三方网关常见模型名，包括 Claude、Gemini、Grok/xAI 和 Mistral；`gemini-pro-agent` 高风险优先级最低，只在更强候选不可用时尝试。runtime 能力必须以 `agent-team subagent status --json` 为准：runtime 通过 provider registry 统一声明是否支持 sandbox、last-message/output capture、JSON 输出、timeout、模型覆盖和 mailbox evidence；`builtin/codex-exec` 是当前默认自动检测 runtime，`explicit/claude-adapter` 默认只在显式 `--runtime claude` 时使用。只有配置 `AGENT_TEAM_SUBAGENT_RUNTIME_FALLBACKS=claude` 或项目级 `runtime.subagent_fallbacks: ["claude"]` 后，策略层才可在 Codex 不可用时显式 fallback 到 Claude，且 status 必须显示 `selectionPolicy.explicitFallbacks`；不要从 Codex 静默切换到 Claude。`editor/zed-rules` 只表示规则入口，不是可派发的 standalone 子代理 runtime；Zed 只有提供稳定 CLI/非交互 agent runtime 后才接入 dispatchable provider。
UI 设计生成、审美改版或视觉质量修复不走普通 routine 排序：生成链默认 `gemini-3-flash-agent` / `gemini-3.5-flash` / `glm-5.2` / `qwen3-max` / `kimi-k2.7-code` 优先，GPT/Codex 只作落地兜底；审美评审链默认 `claude-sonnet-4-6` / `claude-opus-4-8` 优先。UI 任务必须把 `model_profile` 记录为 `ui-design-generation` 或 `ui-aesthetic-review`，并提供截图证据、响应式检查、无重叠/无溢出检查和审美 rubric 评审结论。
`automation review-loop-run` 可用 `--model`、`AGENT_TEAM_REVIEW_LOOP_MODEL` 或 `models.review_loop` 覆盖整轮评审；Goal Forge 深度设计/质证循环可用 `--model`、`AGENT_TEAM_GOAL_FORGE_MODEL` 或 `models.goal_forge` 覆盖；Scheduler 和新建任务默认模型分别使用 `models.scheduler` / `models.task_default`。

### 默认执行流程

`collaboration.mode` 显式描述任务协作形态：

- `solo`：单执行路径；中/高风险必须有 verifier evidence 或 accepted `safe_skip_reason`，否则 `collaboration_plan` / doctor 给 warning。
- `critic`：做审分离，executor 写入后由 critic/verifier 独立复核。
- `pipeline`：explorer → executor → verifier 串行交接，每一阶段把 evidence refs 传给下一阶段。
- `split`：只有 Task Contract 中每个 executor lane 的 `allowed_files` 互斥时才允许并行写入；重叠或缺失时降级为 read-only fanout / 串行。
- `roundtable` / `swarm`：只读讨论、多方案竞选或低风险生成，必须由 orchestrator 或 human 做最终裁决，不能自动并行写入。

**完整流水线任务（中/高风险、多文件、多 subsystem、根因不明、不熟悉区域或需要自审的任务）**：

1. **Orchestrator 读取任务** → 形成 Task Contract
2. **Explorer 探索** → `agent-team subagent dispatch explorer "..." --mailbox 0NN-explorer-result.md`
3. **Executor 实现** → `agent-team subagent dispatch executor "..." --mailbox 0NN-executor-result.md`
4. **Verifier 验证** → `agent-team subagent dispatch verifier "..." --mailbox 0NN-verifier-result.md`
5. **Orchestrator 审查所有子代理输出** → 裁决 PASS/FAIL，更新 coordination DB；legacy 项目才更新 progress.md 和 tasks.md

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
- 子代理 mailbox / run record 应关联 AgentCard（例如 `agent_id`、runtime、model），便于审查执行来源
- 未使用子代理：只允许纯解释/只读/简单命令/格式化/纯文档，记录为什么安全跳过（`safe_skip_reason`）
- 若子代理结论冲突，先通过 `.mailbox/` 或 Task Contract 收敛，不要直接声明完成

### 子代理请求契约

每个子代理 dispatch 必须写清楚：

- `role`：`executor` / `explorer` / `critic` / `verifier`
- `exact scope`：要回答的问题或负责的实现切片
- `read/write ownership`：只读，或允许修改的文件/目录
- `allowed files/directories`：明确边界，避免并行写冲突
- `context isolation`：默认 isolated；显式列出 shared context、handoff artifacts 和合并策略
- `verification command`：需要运行或复核的命令
- `output schema`：至少包含 `verdict`、`evidence`、`blocking_findings`、`non_blocking_risks`、`recommended_next_action`
- `mailbox persistence`：是否必须写 `.mailbox/`，以及 request/response 文件名

不要为常规实现默认升级到 `gpt-5.5`，也不要创建多个 always-on executor 竞争同一个队列。并行写入只有在文件所有权明确互斥时才允许。

### 中断恢复

- 子代理超时、中断、输出结构不完整或 mailbox 缺失时，先更新 Task Contract 的 `interruption_recovery` 字段
- 记录 `resume_state`、`last_stable_artifact`、`dangling_subagents`、`recovery_owner` 和 `recovery_action`
- 只有最后稳定证据足以支撑验收时才能继续；否则重派子代理、请求用户输入或标记 blocked
- 不要把半截输出、未写入 mailbox 的结论或未验证的推测当作完成证据

## 3. 循环执行器（Codex 优先）
- 模型优先：`gpt-5.3-codex`
- 在每个项目内串行循环，直到没有 eligible `ready` 任务
- 同一时间只领取并持有 1 个任务，避免并发抢占
- 每完成或阻塞一个任务后，coordination DB v2 项目重新读取 `agent-team context` / DB 状态；legacy 项目重新读取 `tasks.md`、`progress.md` 和 `.mailbox/` 再决定是否领取下一个
- 先创建独立分支或 worktree，再修改代码
- 实施顺序：
  1. 读取 Task Contract，确认目标和非目标
  2. 按 `skill_loading` 渐进加载相关 skill 和项目代码规范
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

## 4.5. Evidence Gate (Hard Gate)

任务进入 `done` 或 `review` 前，必须满足以下硬约束：

- 至少引用一条新鲜证据：测试命令及退出码、CI run URL、`git diff --check` 输出、构建日志、截图、部署 URL/健康检查、DB 查询结果或日志行之一
- 证据必须是本轮执行的，不接受引用上次运行或上一个 PR 的旧证据
- 没有证据只能标 `partial` 或 `blocked`，不能标 `done`
- 中/高风险任务的证据必须由独立 verifier 子智能体复核，或由 orchestrator 亲自运行验收命令确认
- 纯文档/格式化任务也必须引用 `git diff --check` 或构建/类型检查通过的证据
- 涉及生产数据库、生产对象存储、线上 CMS/KB、搜索索引或外部 API 状态写入时，Task Contract 必须填写 `production_data_gate`；没有通过用户确认生产端点的 live read-back 证据时，不能标 `done`、`PASS` 或“已修复”

此规则适用于所有完成路径，包括 `/dev`、`/task-automation` 和 `/pr-review-merge`。

## 5. 记录要求
- coordination DB v2 项目每次领取、暂停、完成都要写入 DB event / mailbox 队列；legacy 项目才更新 `progress.md` 或通过 `.mailbox/` 留消息
- 中/高风险、长程、多子代理或可恢复任务建议写入 `.agents/state/runs/<run_id>.json`，按 `.agents/state/run-records.schema.json` 保存证据引用、命令和 redaction 状态
- 任务完成后只把稳定事实、决策、已知坑、否决方案或回滚约束写入 `.agents/state/project-memory.json`，并先去重；不要把 coordination DB dump 或 legacy `tasks.md`、`progress.md`、`.mailbox/` 整文件灌入 memory
- 使用 `agent-team matter list|show . --json` 查看 Task Contract 的交付现场；`matter draft|advance|review` 可以生成草案、推进阶段或记录 review event，但不能替代 coordination DB / Task Ledger 状态。
- 使用 `agent-team taste save|recall . --scope <scope> --json` 保存和召回验收偏好；Taste 只影响排序、提示和文案偏好，不能覆盖测试、事实、安全边界、生产确认或用户最新指令。
- 使用 `agent-team automation tcb . --json` 查看 sidecar Thread Control Block；除非必须复核具体证据，否则不要把完整子线程上下文塞回主线程。
- 使用 `agent-team approval request|approve|reject` 记录生产、secret、破坏性 git、数据迁移、发布或不可逆决策的人审暂停/恢复；批准只恢复执行资格，不替代验证。
- 使用 `agent-team automation product-signal` 记录需求/增长/商业方向的真实信号；`agent_score` 只能作为 `--proxy` 上下文，不能作为 CTR/CVR、付费、留存或生产真相。
- 使用 `agent-team automation skill-evolution --write` 把重复 runtime/context/CI/review 失败转成 Matter 草案；不要自动改 skill、workflow 或 runbook。
- 非显而易见的决策写进 commit body 的 `Rejected:` / `Constraint:` / `Directive:`
- 任务平台变更时只更新 provider adapter，不改 Task Contract 语义
