---
description: 自动化健康检查 — 检查卡住任务、权限和队列漂移
---
// turbo-all

# Automation Health Check Workflow

## 0. Scope
- 建议每小时运行一次
- 不实现功能，不合并 PR/MR
- 只做状态核对、轻量修复和风险报告

## 1. Checks
- `running` 任务是否超过预期时间未更新
- `review` PR/MR 是否超过预期时间未审查
- Task Ledger 状态是否与 provider 原始任务、PR/MR 状态一致
- 全局 dashboard 是否只做聚合，没有成为执行任务源
- provider CLI/API 权限是否可用
- CI 状态是否可读取
- 是否存在同一个 Task Contract 对应多个活跃分支或 PR/MR
- 是否存在 stale `.agents/state/locks/*.lock` 或绕过 `agent-team automation claim` 的重复领取迹象
- `.mailbox/` 是否存在过大的 `done` / `archived` 消息，需要运行 `agent-team automation prune-mailbox .`
- 若存在 `.agents/state/tasks.json`，检查中/高风险 `review` / `done` 任务是否记录 subagent evidence 或安全跳过原因
- 若不存在 `.agents/state/tasks.json`，只报告“跳过 subagent evidence enforcement”，不要从 Markdown `tasks.md` 强行推断缺失证据
- GitHub 项目使用 `gh` 检查 auth、repo access、Actions 可见性和 review PR 状态
- CNB 项目至少检查 git 远端访问和 `.cnb.yml` 可见性；如果设置 `CNB_TOKEN` 或 `CNB_API_TOKEN`，再检查 pull 和 commit status
- GitLab 项目至少检查 git 远端访问；深度 MR/CI 检查需要 `glab`

## 2. Remediation
- 低风险漂移：更新本地 ledger 或 provider 状态，并记录原因
- 权限失效：标记 `blocked`，提醒人工处理
- 卡住任务：在 `.mailbox/` 留消息并在 `progress.md` 记录
- 缺失 subagent evidence：只有在机器可读 task state 中可确认时才发 warning；否则要求先补 `.agents/state/tasks.json` 或 Task Contract 字段
- 机器可读状态漂移：运行 `agent-team automation sync-state .` 从 `tasks.md` 重新派生状态，并保留已有 subagent evidence
- mailbox 过大：运行 `agent-team automation prune-mailbox . --max-bytes 131072`，只清理 `done` / `archived` 消息
- 重复 PR/MR：保留最新或最完整的一个，其他只评论不关闭，等待人工确认

## 3. Optional End-to-end Test
- 可每天或每周运行 `agent-team automation smoke`；发布前运行 `agent-team automation release-check`
- no-op 任务验证 deploy、skill 同步、领取、分支、提交、review/done 和清理流程
- smoke 使用独立本地沙盒，不要在生产仓库制造无意义 PR/MR
- smoke 失败时标记自动化链路 `FAIL`，先修复框架再恢复真实任务执行

## 4. Output
- 输出健康状态：`PASS` / `WARN` / `FAIL`
- 列出卡住任务、权限问题、漂移项和已执行的低风险修复
- 把摘要写入 `progress.md`
