---
description: 自动化烟雾测试 — 在沙盒里运行 no-op 任务闭环
---
// turbo-all

# Automation Smoke Workflow

## 0. Scope

- 只验证 agent-team 自动化框架本身
- 只运行本地沙盒 no-op 流程
- 不访问生产项目，不创建真实 PR/MR，不修改业务仓库

## 1. Command

```bash
agent-team automation smoke
```

发布前运行完整门禁：

```bash
agent-team automation release-check
```

可选保留沙盒用于排查：

```bash
agent-team automation smoke ./tmp-agent-team-smoke --keep
```

## 2. Checks

- deploy 是否能在空项目生成完整 `.agents/`、`tasks.md`、`progress.md`、`.mailbox/`
- deploy 后必需文件 manifest 是否完整，包括自动化模板和关键 workflow（如 `/design-review`、`/task-automation`、`/pr-review-merge`）
- Codex skill 同步是否覆盖 `references/skills/*/SKILL.md`
- Task Ledger 是否能解析 `ready` 任务
- mailbox 是否没有 pending 冲突消息
- 执行器是否能把任务推进到 `running`
- 是否能创建隔离分支并完成本地 no-op 提交
- 是否能把任务推进到 `review`
- 审查模拟是否能确认 no-op 提交存在
- 是否能把任务推进到 `done`
- ready / running / review 队列是否清空
- 临时沙盒是否按预期清理
- release-check 额外验证 `setup.ts` 可打包且 `git diff --check` 通过

## 3. Failure Handling

- smoke 失败时输出 `FAIL`
- 报告失败阶段、命令输出和建议修复点
- 先修复自动化框架，再恢复真实任务执行
- 不要为了让 smoke 通过而放宽真实任务契约

## 4. Output

- `PASS`：沙盒 no-op 自动化闭环完成
- `FAIL`：自动化框架存在阻断问题
