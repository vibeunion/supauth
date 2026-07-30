---
description: 聚合 token 用量报告，基于 ccusage 输出
---
# Token Report Workflow

## 规则
- **禁止**读取原始 API 日志文件
- **必须**使用 `ccusage` 工具/命令获取聚合统计数据
- 若 ccusage 不可用，报告缺失并停止，不要回退到原始日志
- 压缩/召回方案变更进入默认路径前，先运行 `agent-team automation promotion-gate .`；`/token-report` 只提供用量趋势，不替代 memory benchmark 的命中率和 token 缩减门禁
- 排查单个 Codex 会话上下文膨胀时，使用 `agent-team automation inspect-session-context <session-id|session-file>`；该命令只输出热点摘要，不读取或打印原始 API 日志。
- 视觉证据必须优先保留文件路径和文字观察，不把 `data:image/*;base64`、`input_image` 或大截图 payload 复制到报告、mailbox、progress 或 Task Contract。

## 步骤

1. 运行 `ccusage` 获取聚合 token 用量：
   ```bash
   npx -y ccusage@latest codex daily --since 2026-06-01 --timezone Asia/Shanghai --no-color
   npx -y ccusage@latest codex session --since 2026-06-10 --timezone Asia/Shanghai --no-color
   ```
2. 解析输出，提取：总 token 数、按模型分布、按日期分布（最近 7 天）
3. 汇总为结构化 Markdown 表格
4. 标注异常峰值（单日用量超过 7 日均值 2x）
5. 输出报告，不输出原始日志内容

## 会话上下文热点排查

当用户报告 `Your input exceeds the context window of this model` 或长流程末尾没有 final 回复时：

1. 先定位会话 ID 或 `.jsonl` 文件。
2. 运行：
   ```bash
   agent-team automation inspect-session-context <session-id-or-jsonl> --top 12
   ```
3. 只记录摘要字段：文件路径、总大小、图片/base64 行数、最新 token_count、最大热点行号和原因。
4. 若热点包含 `data:image` / `input_image` / `base64`，处理方式是 fork 或新开线程，用短文字摘要接续；截图证据只引用本地文件路径。
