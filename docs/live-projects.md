# Live SupaCloud Projects

本文件记录 SupaOAuth 在当前西谷 SupaCloud 环境中的项目 ref 角色，避免把中央 SupAuth 身份项目和业务应用项目混用。

## 项目角色

| Project ref | 数据库 | 公开入口 | 角色 | 用途 |
| --- | --- | --- | --- | --- |
| `vwsvexjelurvczfivgiz` | `supa_vwsvexjelurvczfivgiz` | `https://auth.ai.xigu.team` | SupAuth 正式身份项目 | 承载中央 GoTrue、SupAuth Function、账号领取和管理入口。SupAuth 生产部署、配置和线上验收默认以它为目标。 |
| `dglewlzugrtygzysqrce` | `supa_dglewlzugrtygzysqrce` | —（非 SupAuth 入口） | 业务应用项目 | 承载业务应用数据和业务 Function；不是 SupAuth 正式项目，也不能替代中央身份项目。 |

## 操作规则

- SupAuth Function、中央身份、账号领取和 SupAuth 生产配置：默认只操作 `vwsvexjelurvczfivgiz`。
- 业务数据和业务 Function：仍操作各自所属的业务项目；`dglewlzugrtygzysqrce` 不能作为 SupAuth 部署目标。
- 需要跨中央身份项目和业务应用项目操作时，命令、PR 描述或进度记录必须明确写出两个目标及原因。
- `https://auth.ai.xigu.team/v1/health` 的 `project_ref` 应为 `vwsvexjelurvczfivgiz`，不能用 `dglewlzugrtygzysqrce` 作为 SupAuth 正式环境验收依据。

## 常用核验

```bash
bun run projects:describe
```

该命令只输出项目角色映射，不读取或打印任何密钥。需要实时数据库/流量证据时，再通过 vm1 只读查询确认。
