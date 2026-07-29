const liveProjects = [
  {
    role: 'supauth-production',
    label: 'SupAuth 正式身份项目',
    projectRef: 'vwsvexjelurvczfivgiz',
    database: 'supa_vwsvexjelurvczfivgiz',
    publicUrl: 'https://auth.ai.xigu.team',
    runtimeUrl: 'https://auth.ai.xigu.team',
    defaultFor: ['SupAuth Function', '中央身份', '账号领取', 'SupAuth 生产配置和验收'],
  },
  {
    role: 'business-application',
    label: '业务应用项目（非 SupAuth 正式项目）',
    projectRef: 'dglewlzugrtygzysqrce',
    database: 'supa_dglewlzugrtygzysqrce',
    publicUrl: '非 SupAuth 公开入口',
    runtimeUrl: '由业务应用单独配置',
    defaultFor: ['所属业务数据', '所属业务 Function'],
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

console.log('规则：SupAuth 操作默认只针对 vwsvexjelurvczfivgiz；业务操作仍按各自项目边界执行。');
