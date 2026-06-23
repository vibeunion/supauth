const liveProjects = [
  {
    role: 'business-production',
    label: '业务生产项目',
    projectRef: 'dglewlzugrtygzysqrce',
    database: 'supa_dglewlzugrtygzysqrce',
    publicUrl: 'https://auth.ai.xigu.team',
    runtimeUrl: 'https://dglewlzugrtygzysqrce.ai.xigu.team',
    defaultFor: ['业务数据迁移', '真实用户/RBAC 修复', '生产配置变更', '线上业务验收'],
  },
  {
    role: 'supauth-validation',
    label: 'SupAuth 开源验证项目',
    projectRef: 'vwsvexjelurvczfivgiz',
    database: 'supa_vwsvexjelurvczfivgiz',
    publicUrl: 'https://supauth.ai.xigu.team',
    runtimeUrl: 'https://vwsvexjelurvczfivgiz.ai.xigu.team',
    defaultFor: ['安装器验证', '发布前 smoke', 'GitHub/开源提交验证', '自托管演示'],
  },
] as const;

for (const project of liveProjects) {
  console.log(`${project.label} (${project.role})`);
  console.log(`  project_ref: ${project.projectRef}`);
  console.log(`  database: ${project.database}`);
  console.log(`  public_url: ${project.publicUrl}`);
  console.log(`  runtime_url: ${project.runtimeUrl}`);
  console.log(`  default_for: ${project.defaultFor.join('、')}`);
  console.log('');
}

console.log('规则：业务操作默认只针对 dglewlzugrtygzysqrce；同时操作两个项目时必须说明同步验证项目的原因。');
