import { defineSupacloudConfig } from '@supacloud/compiler';

// 正常构建默认 enforce；离线测试或显式 SUPACLOUD_DATABASE_GOVERNANCE=check 时只校验源契约。
const databaseGovernanceMode =
  process.env.NODE_ENV === 'test' || process.env['SUPACLOUD_DATABASE_GOVERNANCE'] === 'check'
    ? 'check'
    : 'enforce';

export default defineSupacloudConfig({
  root: 'src/app',
  include: ['**/*.ts'],
  outDir: 'generated',
  strict: true,
  // 路由输入/响应由 domain 契约与运行期解码器负责，生成器不再重复要求 TypeBox 声明。
  requireRouteContracts: false,
  databaseGovernance: {
    mode: databaseGovernanceMode,
    projectRoot: '.',
    moduleFile: 'src/db/modules.ts',
    databaseUrlEnv: 'SUPACLOUD_DATABASE_URL',
    schemas: ['supaoauth'],
  },
  generateClient: false,
  generateOpenApi: false,
  generatePermissions: true,
  moduleBoundaryPreset: 'modular-monolith',
  typeSafety: {
    scanProductionSource: true,
    noAnyInGenerated: true,
  },
});
