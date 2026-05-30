---
description: 任务自动化 — 从任务契约领取、执行、提 PR/MR
---
// turbo-all

# Task Automation Workflow

## 0. Pre-Execution Gate
- 优先读取 `progress.md`、`.mailbox/`、`tasks.md` 和 Task Contract
- 若任务来源不明确，先看 Task Contract，再回查 provider 原始任务
- 识别任务相关 skill、项目代码规范、测试约定和提交规范
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
  - 影响文件/模块
  - 风险等级与回滚
- 任务状态建议：`ready` → `running` → `review` → `done`

## 2. 循环执行器（Codex 优先）
- 模型优先：`gpt-5.3-codex`
- 在每个项目内串行循环，直到没有 eligible `ready` 任务
- 同一时间只领取并持有 1 个任务，避免并发抢占
- 每完成或阻塞一个任务后，重新读取 `tasks.md`、`progress.md` 和 `.mailbox/` 再决定是否领取下一个
- 先创建独立分支或 worktree，再修改代码
- 实施顺序：
  1. 读取 Task Contract，确认目标和非目标
  2. 加载相关 skill 和项目代码规范
  3. 领取任务并写入 owner / branch / provider 状态
  4. 最小实现
  5. 测试 / 类型检查 / 构建
  6. 提交并推送
  7. 创建 PR/MR
- 完成后把任务状态改为 `review`
- 遇到模糊、风险高、缺少验收标准、缺少 skill/代码规范或邮箱冲突的任务，标记 `blocked` 或留下明确说明，然后重新读取 ledger，继续处理下一个 eligible `ready` 任务

## 3. 审查移交
- 执行器不自行合并自己的 PR/MR
- PR/MR 描述必须引用 Task Contract，并逐条列出验收证据、使用的 skill 和遵循的代码规范
- 若发现契约缺失、任务过大或风险上升，改为 `blocked` 并说明原因

## 4. 记录要求
- 每次领取、暂停、完成都要更新 `progress.md`
- 需要协作时通过 `.mailbox/` 留消息
- 非显而易见的决策写进 commit body 的 `Rejected:` / `Constraint:` / `Directive:`
- 任务平台变更时只更新 provider adapter，不改 Task Contract 语义
