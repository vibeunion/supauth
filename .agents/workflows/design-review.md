---
description: 设计审查 — 对架构、API、数据模型和高风险方案做只读质证
---
// turbo-all

# Design Review Workflow

## 0. Scope
- 只读审查，不实现、不提交、不合并
- 适用于架构设计、API 契约、数据模型、状态机、迁移方案、安全/权限/计费/生产方案，以及 Task Contract 范围不清但需要先收敛的任务
- 若项目使用 Goal Forge，agent-team 只记录任务、进度和 mailbox；Goal Forge 负责产物契约、反驳账本、决策账本和 evidence ledger

## 1. Inputs
- Task Contract 或明确的审查目标
- 被审查设计文档、ADR、issue、PR/MR、diff 或相关代码路径
- 相关 skill、项目规则、验收标准和风险等级
- 若涉及技术栈、Fullstack Web、数据库或部署目标选择：Stack/Fullstack/Database/Deployment Profile、decision source、evidence、recommended fallback 或 blocked 原因
- 可选：Goal Forge run 路径或 ledger 路径

## 2. Review Contract
检查设计产物是否覆盖：
- Goal
- Non-goals
- User Scenario
- Core Concepts
- Data Model
- Field Naming Rationale
- State Transitions
- Failure Modes
- Acceptance Criteria
- Open Questions

若产物类型不适合上述 section，必须说明替代契约，并保留目标、非目标、状态/边界、失败模式和验收标准。

## 3. Adversarial Review
- 对每个关键命名、字段、状态迁移、边界条件和失败模式提出反证问题
- 检查设计是否混淆事实、假设、决策和待验证项
- 检查 evidence 是否有来源、置信度和适用范围
- 检查 Stack/Fullstack/Database/Deployment Profile 是否遵循 user/docs/existing evidence 优先，推荐 fallback 是否只用于 greenfield，是否误触发框架、数据库或托管平台迁移
- 检查每个 accepted risk 是否有 owner、触发条件和后续验证方式
- 检查是否存在未关闭的 open question 会阻塞实现

## 4. Subagent Requirement
- 中/高风险设计必须至少经过一个独立 critic/verifier 子智能体审查，或使用 Goal Forge 等价质证流程
- 涉及安全、权限、数据迁移、不可逆变更、生产配置或跨多个 subsystem 的设计，必须有独立审查证据
- 若无法使用子智能体，必须记录原因、替代验证方式和剩余风险

## 5. Output Contract
输出必须包含：
- `Verdict`: `pass` / `pass-with-risk` / `block`
- `Findings`: 按 `P0` / `P1` / `P2` 排序，包含证据位置
- `Required Changes`: 阻塞项或必须补充的契约字段
- `Accepted Risks`: 已接受风险、owner 和后续验证方式
- `Subagent Evidence`: 使用的子智能体、结论和分歧处理
- `Stack/Fullstack/Database/Deployment Decision`: profile、决策来源、证据、所需 skills、阻塞询问项
- `Next Step`: 可进入 `/task-automation`、需要重写设计、或需要人工决策

## 6. Boundary
- agent-team-config 不替代 Goal Forge 的 ledger；只在 `progress.md`、Task Contract 或 `.mailbox/` 中引用 Goal Forge run / ledger 路径
- 设计审查通过不代表实现完成；实现仍需 `/task-automation` 或 `/dev` 的测试、构建和运行证据
