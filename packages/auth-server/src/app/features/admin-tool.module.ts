import { Controller, defineModule, Injectable, Post, Get } from '@supacloud/app';
import { adminToolRoutes } from '../../routes/admin-tools.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';

@Injectable()
export class AdminToolPostAuthorizationCompilerAction {
  execute(context: Parameters<typeof adminToolRoutes.operations.postAuthorizationCompiler.execute>[0]) {
    requireAdminAction('operations.manage');
    return adminToolRoutes.operations.postAuthorizationCompiler.execute(context);
  }
}

@Injectable()
export class AdminToolPostRlsMigrationAction {
  execute(context: Parameters<typeof adminToolRoutes.operations.postRlsMigration.execute>[0]) {
    requireAdminAction('operations.manage');
    return adminToolRoutes.operations.postRlsMigration.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/admin-tools")
export class AdminToolController {
  constructor(
    private readonly postAuthorizationCompilerAction: AdminToolPostAuthorizationCompilerAction,
    private readonly postRlsMigrationAction: AdminToolPostRlsMigrationAction,
  ) {}

  @Post("/authorization-compiler", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/admin-tools.ts#postAuthorizationCompiler" },
    aspects: [adminHttpAspect],
  })
  postAuthorizationCompiler(ctx: HttpInvocation): Promise<Response> {
    return adminToolRoutes.operations.postAuthorizationCompiler.invoke(ctx, context => this.postAuthorizationCompilerAction.execute(context));
  }

  @Get("/authorization-compiler/demo", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/admin-tools.ts#getAuthorizationCompilerDemo" },
    aspects: [adminHttpAspect],
  })
  getAuthorizationCompilerDemo(ctx: HttpInvocation): Promise<Response> {
    return adminToolRoutes.operations.getAuthorizationCompilerDemo.invoke(ctx);
  }

  @Post("/rls-migration", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/admin-tools.ts#postRlsMigration" },
    aspects: [adminHttpAspect],
  })
  postRlsMigration(ctx: HttpInvocation): Promise<Response> {
    return adminToolRoutes.operations.postRlsMigration.invoke(ctx, context => this.postRlsMigrationAction.execute(context));
  }

  @Get("/rls-migration/demo", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/admin-tools.ts#getRlsMigrationDemo" },
    aspects: [adminHttpAspect],
  })
  getRlsMigrationDemo(ctx: HttpInvocation): Promise<Response> {
    return adminToolRoutes.operations.getRlsMigrationDemo.invoke(ctx);
  }

}

export const AdminToolModule = defineModule({
  name: 'supauth-admin-tool',
  tags: ['type:feature', 'scope:supauth-admin-tool'],
  providers: [AdminToolPostAuthorizationCompilerAction, AdminToolPostRlsMigrationAction],
  controllers: [AdminToolController],
});
