---
description: 待办自审 — 扫描项目发现可改进点并生成候选任务
---
// turbo-all

# Backlog Sweep Workflow

## 0. Scope

- 只做只读扫描 + 候选任务生成，不直接改业务代码
- 频率低于 Scheduler：每周一次，或 Task Ledger `ready` 队列为空且无 `review`/`running` 任务时触发
- 与 Scheduler 同轮触发时，sweep 先于 ready 消费，但 sweep 生成的任务不参与同轮领取

## 1. Guardrails（硬约束，不可放宽）

- **最多 3 个候选/轮**：超过的丢弃，并在 coordination DB event（legacy 项目为 progress.md）记录"已丢弃候选 N 条，下次再扫"
- **风险上限**：所有候选 `risk` 必须为 `low`；`medium`/`high` 只写 mailbox 候选说明（v2 为 DB mailbox，legacy 为 `.mailbox/`），不自动入队，等人工裁定
- **禁区**：禁止生成修改以下框架核心的任务，这类发现只写 mailbox 提示人工：
  - `setup.ts`
  - `.agents/workflows/*.md`
  - `.agents/automations/*.md`
  - `templates/**`
  - 本文件（`backlog-sweep.md`）及其护栏定义
- **完整性门槛**：每条候选必须能填出完整 Task Contract（目标、非目标、验收标准、相关 skill、影响范围、风险、回滚、验证计划）；否则标 `invalid`，不入队
- **去重**：候选不得与当前执行源中任何 `ready`/`running`/`review`/`done`/`archived` 任务的目标重复；重复的丢弃
- **不自动领取**：sweep 写入当前执行源的任务一律保持 `ready`，由下一轮 Scheduler 走正常 Delegation Gate 领取，sweep 同轮不碰它们
- **空输出**：无可生成候选时输出 `NOOP`，不写 progress、不发 mailbox、不创建 follow-up

## 2. Scan Targets（只读）

- 测试覆盖缺口：未覆盖的关键模块、失败或跳过的测试
- 文档漂移：README / AGENTS.md / 注释与代码不一致
- 类型与 lint 残留：`tsc`/`lint` 警告，TODO/FIXME/HACK 标记
- 依赖与配置陈旧：过时依赖、冗余配置、可清理的死代码
- skill / 工作流缺口：项目代码明显需要但未加载的 skill
- 上述范围之外的"改进想法"不自动入队，可写 mailbox 提示人工

## 3. Process

1. 轻量只读扫描，不读无关大文件；只收集生成候选所需的最小信息
2. 对照当前执行源（v2 coordination DB，legacy `tasks.md`）现有任务去重
3. 对每个候选套护栏检查：风险、禁区、完整性、去重
4. 通过护栏的 `low` risk 候选：写入当前执行源，状态 `ready`，`source_url` 标 `backlog-sweep`，并写完整 Task Contract；legacy 项目才按 `tasks.md` 表格格式追加到末尾
5. `medium`/`high` 候选和禁区候选：只写 mailbox 队列，收件人 `human`，列出发现、建议和为什么不自动入队；v2 项目写 DB mailbox，legacy 项目写 `.mailbox/<NN>-sweep-candidate-<slug>.md`
6. 通过 `agent-team automation sweep-record . --generated <task_id,...> --claim-after <iso> --force` 更新 sweep 状态：coordination DB v2 写入 `sweep_state`，legacy 项目写 `.agents/state/sweep.json`，使 `automation claim` 能拒绝同轮领取
7. v2 项目写 DB event / mailbox 队列；legacy 项目才在 progress.md 写一行 sweep 摘要：`[time] [workspace] [sweep] N 候选入队，M 候选转 mailbox，K 候选丢弃`

## 4. 候选任务格式

legacy 项目追加到 `tasks.md` 的行：

```md
| ATC-0NN | local | <repo> | backlog-sweep | <一句话标题> | normal | low | ready | - | gpt-5.3-codex | - | - | codex/atc-0NN-<slug> | - |

> 注：v2 项目直接写入 coordination DB task source metadata；legacy 项目把 `backlog-sweep` 写入 `source_url` 列（第 4 列），与 `tasks.md` 表头一致，便于去重和审计。
```

并在 Task Contract 段落补全目标、非目标、验收标准、影响文件、skill、风险、回滚、验证计划。

## 5. 代码级强制（方案 B）

本 workflow 仍负责只读扫描和候选生成，但关键护栏已在 `agent-team automation claim` 侧做代码级兜底：

- **机器可读冷却与同轮阻断**：coordination DB v2 的 `sweep_state`（legacy 的 `.agents/state/sweep.json`）记录 `last_sweep_id`、`last_sweep_at`、`claim_gate.claim_after` 和 `generated_tasks`。Scheduler 进入 sweep 前可运行 `agent-team automation sweep-check .` 执行冷却校验；sweep 完成后运行 `agent-team automation sweep-record .` 写入本轮状态。如果 sweep 生成的任务仍在 `claim_after` 之前，`automation claim` 会拒绝领取，防止 sweep → 同轮 implement 的紧耦合自放大循环。
- **框架核心 deny-list**：sweep state 的 `guardrails.core_denylist` 默认包含 `setup.ts`、`.agents/workflows/**`、`.agents/automations/**`、`templates/**`。`source_url: backlog-sweep` 任务的 Task Contract 如果提到这些路径，`automation claim` 会拒绝领取，要求转 mailbox / human 裁定。
- **影响面限定**：代码闸门只作用于 `source_url` 列为 `backlog-sweep` 的任务；用户请求、provider 同步或人工创建的任务不受 sweep 专用 deny-list 影响，仍按普通 Delegation Gate 执行。

仍需人工纪律：sweep 生成候选时必须通过 `sweep-record` 同步更新 sweep state，否则 claim 侧只能执行 deny-list 兜底，无法识别同轮生成关系。每次发布前运行 `agent-team automation release-check` 验证 deploy、测试和状态模板完整性。

## 6. 失败与异常

- 扫描报错或无法读取关键文件：输出 `WARN`，写 coordination DB event（legacy 项目写 progress.md）一行，不生成任何候选
- 生成的候选被下一轮 Scheduler 判定契约不完整：Scheduler 正常标 `invalid` 或 `blocked`
- 发现 sweep 自身护栏被绕过或缺失：写 mailbox 给 human，不自动修复护栏

## 7. 与 Scheduler 的关系

- Scheduler 在 `ready`/`review`/`running` 全空且距上次 sweep 超过阈值（默认 7 天）时，在 prompt 分支里调用本 workflow 的扫描逻辑
- sweep 不算作"可执行任务"，不占用 Scheduler 的串行领取槽
- sweep 完成后 Scheduler 正常结束本轮，候选留给下一轮处理
