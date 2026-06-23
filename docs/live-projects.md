# Live SupaCloud Projects

本文件记录 SupaOAuth 在当前西谷 SupaCloud 环境中的项目 ref 角色，避免把业务项目和开源验证项目混用。

## 项目角色

| Project ref | 数据库 | 公开入口 | 角色 | 用途 |
| --- | --- | --- | --- | --- |
| `dglewlzugrtygzysqrce` | `supa_dglewlzugrtygzysqrce` | `https://auth.ai.xigu.team` / `https://dglewlzugrtygzysqrce.ai.xigu.team` | 业务生产项目 | 承载真实业务登录、用户、权限和 SupAuth overlay。生产数据迁移、业务修复和线上验证默认以它为目标。 |
| `vwsvexjelurvczfivgiz` | `supa_vwsvexjelurvczfivgiz` | `https://supauth.ai.xigu.team` / `https://vwsvexjelurvczfivgiz.ai.xigu.team` | SupAuth 开源验证项目 | 用于 SupAuth 自身安装器、发布前 smoke、GitHub 提交/开源验证和自托管演示；默认不承载实际业务。 |

## 操作规则

- 业务数据迁移、真实用户修复、权限/RBAC 变更、生产配置变更：默认只操作 `dglewlzugrtygzysqrce`。
- 开源发布验证、安装器验证、SupAuth artifact smoke、自托管演示：使用 `vwsvexjelurvczfivgiz`。
- 需要同时操作两个项目时，命令、PR 描述或进度记录必须明确写出原因，例如“同步验证项目以证明开源安装包兼容”。
- 不要把 `vwsvexjelurvczfivgiz` 的小样本用户/配置当作业务验收证据；业务验收应以 `dglewlzugrtygzysqrce` 的运行时和数据库为准。

## 常用核验

```bash
bun run projects:describe
```

该命令只输出项目角色映射，不读取或打印任何密钥。需要实时数据库/流量证据时，再通过 vm1 只读查询确认。
