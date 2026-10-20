import { Controller, defineModule, Injectable, Get, Post } from '@supacloud/app';
import { provisioningRoutes } from '../../routes/provisioning.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';

@Injectable()
export class ProvisioningPostByProjectRefReconcileAction {
  execute(context: Parameters<typeof provisioningRoutes.operations.postByProjectRefReconcile.execute>[0]) {
    requireAdminAction('operations.manage');
    return provisioningRoutes.operations.postByProjectRefReconcile.execute(context);
  }
}

@Injectable()
export class ProvisioningPostByProjectRefRollbackAction {
  execute(context: Parameters<typeof provisioningRoutes.operations.postByProjectRefRollback.execute>[0]) {
    requireAdminAction('operations.manage');
    return provisioningRoutes.operations.postByProjectRefRollback.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/provisioning")
export class ProvisioningController {
  constructor(
    private readonly postByProjectRefReconcileAction: ProvisioningPostByProjectRefReconcileAction,
    private readonly postByProjectRefRollbackAction: ProvisioningPostByProjectRefRollbackAction,
  ) {}

  @Get("/:projectRef", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/provisioning.ts#getByProjectRef" },
    aspects: [adminHttpAspect],
  })
  getByProjectRef(ctx: HttpInvocation): Promise<Response> {
    return provisioningRoutes.operations.getByProjectRef.invoke(ctx);
  }

  @Post("/:projectRef/reconcile", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/provisioning.ts#postByProjectRefReconcile" },
    aspects: [adminHttpAspect],
  })
  postByProjectRefReconcile(ctx: HttpInvocation): Promise<Response> {
    return provisioningRoutes.operations.postByProjectRefReconcile.invoke(ctx, context => this.postByProjectRefReconcileAction.execute(context));
  }

  @Post("/:projectRef/rollback", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/provisioning.ts#postByProjectRefRollback" },
    aspects: [adminHttpAspect],
  })
  postByProjectRefRollback(ctx: HttpInvocation): Promise<Response> {
    return provisioningRoutes.operations.postByProjectRefRollback.invoke(ctx, context => this.postByProjectRefRollbackAction.execute(context));
  }

}

export const ProvisioningModule = defineModule({
  name: 'supauth-provisioning',
  tags: ['type:feature', 'scope:supauth-provisioning'],
  providers: [ProvisioningPostByProjectRefReconcileAction, ProvisioningPostByProjectRefRollbackAction],
  controllers: [ProvisioningController],
});
