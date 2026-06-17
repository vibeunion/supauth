---
description: 聚合 token 用量报告，基于 ccusage 输出
---
# Token Report Workflow

## 规则
- **禁止**读取原始 API 日志文件
- **必须**使用 `ccusage` 工具/命令获取聚合统计数据
- 若 ccusage 不可用，报告缺失并停止，不要回退到原始日志

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
