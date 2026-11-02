import { defineDatabaseModule } from '@supacloud/db';

/**
 * SupaAuth 数据库治理清单。
 *
 * 表结构与策略仍由追加式迁移维护；这里声明需要运行时对账的 RPC 函数。
 * 表级 RLS 在 SupaCloud 托管库中由平台策略管理，因此本模块只声明函数所有权。
 */
export default defineDatabaseModule({
  name: 'supaoauth',
  tables: [],
  policies: [],
  functions: [
    {
      name: 'supaoauth.current_project_ref',
      signature: 'supaoauth.current_project_ref()',
      source: 'src/db/functions/current_project_ref.sql',
      security: 'invoker',
      tests: ['src/db/tests/functions/current_project_ref.test.sql'],
    },
    {
      name: 'supaoauth.current_project_claims',
      signature: 'supaoauth.current_project_claims()',
      source: 'src/db/functions/current_project_claims.sql',
      security: 'definer',
      tests: ['src/db/tests/functions/current_project_claims.test.sql'],
    },
    {
      name: 'supaoauth.current_permission_claims',
      signature: 'supaoauth.current_permission_claims(uuid)',
      source: 'src/db/functions/current_permission_claims.sql',
      security: 'definer',
      tests: ['src/db/tests/functions/current_permission_claims.test.sql'],
    },
    {
      name: 'supaoauth.authorize',
      signature: 'supaoauth.authorize(text, uuid)',
      source: 'src/db/functions/authorize.sql',
      security: 'definer',
      tests: ['src/db/tests/functions/authorize.test.sql'],
    },
    {
      name: 'supaoauth.has_permission',
      signature: 'supaoauth.has_permission(text, uuid)',
      source: 'src/db/functions/has_permission.sql',
      security: 'definer',
      tests: ['src/db/tests/functions/has_permission.test.sql'],
    },
    {
      name: 'supaoauth.has_org_permission',
      signature: 'supaoauth.has_org_permission(uuid, text)',
      source: 'src/db/functions/has_org_permission.sql',
      security: 'definer',
      tests: ['src/db/tests/functions/has_org_permission.test.sql'],
    },
    {
      name: 'supaoauth.app_has_org_permission',
      signature: 'supaoauth.app_has_org_permission(text, uuid, text)',
      source: 'src/db/functions/app_has_org_permission.sql',
      security: 'definer',
      tests: ['src/db/tests/functions/app_has_org_permission.test.sql'],
    },
  ],
  triggers: [],
  grants: [],
});
