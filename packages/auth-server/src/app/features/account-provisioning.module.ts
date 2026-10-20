import { Controller, defineModule, Injectable, Post, Get } from '@supacloud/app';
import { accountProvisioningRoutes } from '../../routes/account-provisioning.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';

@Injectable()
export class AccountProvisioningPostImportAction {
  execute(context: Parameters<typeof accountProvisioningRoutes.operations.postImport.execute>[0]) {
    requireAdminAction('account_center.manage');
    return accountProvisioningRoutes.operations.postImport.execute(context);
  }
}

@Injectable()
export class AccountProvisioningPostSyncAction {
  execute(context: Parameters<typeof accountProvisioningRoutes.operations.postSync.execute>[0]) {
    requireAdminAction('account_center.manage');
    return accountProvisioningRoutes.operations.postSync.execute(context);
  }
}

@Injectable()
export class AccountProvisioningPostSyncReconcileAction {
  execute(context: Parameters<typeof accountProvisioningRoutes.operations.postSyncReconcile.execute>[0]) {
    requireAdminAction('account_center.manage');
    return accountProvisioningRoutes.operations.postSyncReconcile.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/account-provisioning")
export class AccountProvisioningController {
  constructor(
    private readonly postImportAction: AccountProvisioningPostImportAction,
    private readonly postSyncAction: AccountProvisioningPostSyncAction,
    private readonly postSyncReconcileAction: AccountProvisioningPostSyncReconcileAction,
  ) {}

  @Post("/import", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-provisioning.ts#postImport" },
    aspects: [adminHttpAspect],
  })
  postImport(ctx: HttpInvocation): Promise<Response> {
    return accountProvisioningRoutes.operations.postImport.invoke(ctx, context => this.postImportAction.execute(context));
  }

  @Get("/records", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-provisioning.ts#getRecords" },
    aspects: [adminHttpAspect],
  })
  getRecords(ctx: HttpInvocation): Promise<Response> {
    return accountProvisioningRoutes.operations.getRecords.invoke(ctx);
  }

  @Post("/sync", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-provisioning.ts#postSync" },
    aspects: [adminHttpAspect],
  })
  postSync(ctx: HttpInvocation): Promise<Response> {
    return accountProvisioningRoutes.operations.postSync.invoke(ctx, context => this.postSyncAction.execute(context));
  }

  @Post("/sync/reconcile", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-provisioning.ts#postSyncReconcile" },
    aspects: [adminHttpAspect],
  })
  postSyncReconcile(ctx: HttpInvocation): Promise<Response> {
    return accountProvisioningRoutes.operations.postSyncReconcile.invoke(ctx, context => this.postSyncReconcileAction.execute(context));
  }

  @Get("/sync/status", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-provisioning.ts#getSyncStatus" },
    aspects: [adminHttpAspect],
  })
  getSyncStatus(ctx: HttpInvocation): Promise<Response> {
    return accountProvisioningRoutes.operations.getSyncStatus.invoke(ctx);
  }

}

export const AccountProvisioningModule = defineModule({
  name: 'supauth-account-provisioning',
  tags: ['type:feature', 'scope:supauth-account-provisioning'],
  providers: [AccountProvisioningPostImportAction, AccountProvisioningPostSyncAction, AccountProvisioningPostSyncReconcileAction],
  controllers: [AccountProvisioningController],
});
