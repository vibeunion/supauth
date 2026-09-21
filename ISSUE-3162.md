# FA #3162 定向修复

本次范围：GoTrue 授权资源不存在时的 BFF 分类、路由回退和托管登录页失效处理。
不修改账号、密码、权限、认证配置、数据库或菜单。
关联 FA #3162，但不自动关闭；此修复不代表已查明原账号登录失败的根因。

## 验证

```sh
bun run --filter @supauth/shared build
ISSUE_3162_SOURCE_DIR=/tmp RUN_ISSUE_3162_BROWSER=1 \
  PLAYWRIGHT_EXECUTABLE_PATH='/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' \
  bun test tests/issue-3162-oauth-recovery.test.ts
git diff --check
```

2026-09-21 结果：7 pass、0 fail、63 assertions。默认测试不要求线上备份或
浏览器；设置上述环境变量才执行候选制品和浏览器验证。

`ISSUE_3162_SOURCE_DIR` 必须包含从精确在线版本只读导出的
`issue-3162-test-before.json` 与 `issue-3162-production-before.json`。
它们实际为 JavaScript 编译源码，不是 JSON；历史导出文件名保持不变。

## 发布约束

`scripts/issue-3162-scoped-hotfix.ts` 只接受已核实 SHA-256 的测试 v74、
生产 v43 编译脚本，以 AST 定位并修改两个函数及内嵌登录页。
拒绝任意其他源码或重复生成输出，不会自动部署。

这些版本存在独立静态目录，不能把生成脚本单独上传作为完整 Function。
必须先取得原版本完整发布目录，保留所有无关资源，并对静态
`admin-console/build/authorize.html` 使用同一个 `patchAuthorizationHtml` 转换。
若它与在线内嵌页存在不同版本或找不到唯一锚点，停止发布，不猜测替换。

2026-09-21 经用户确认后已只读导出两套完整目录，使用 `prepareLiveBundle`
生成多文件发布包并通过官方 CLI 发布：测试 v74 → v75、生产 v43 → v44。
每套 116 个源文件只改入口和登录页，115 个静态文件 HTTP 哈希回读通过。
本轮回归为 7 pass、63 assertions，覆盖两个桌面视口。
没有真实质量审核账号登录验收，Issue 不关闭。

热修复制品基于受 SHA-256 校验的旧版本生成，并非由本 PR 的完整源码构建。
本 PR 收录对应源码修复、回归测试和受限生成脚本，便于审查与追溯。
下载的生产制品在模拟上游响应下验证了错误分类和单次请求行为，
但这不等于真实账号端到端验收。以上为已有发布记录，本 PR 提交不再部署。

发布证据保存在 FA 工作区 `output/issue-3162/`；完整结果见
`output/issue-3162-auth-investigation-20260921.md`。
