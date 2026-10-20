import { Controller, defineModule, Injectable, Get, Put, Delete, Post } from '@supacloud/app';
import { tenantConfigRoutes } from '../../routes/tenant-config.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';

@Injectable()
export class TenantConfigPutByTypeByKeyAction {
  execute(context: Parameters<typeof tenantConfigRoutes.operations.putByTypeByKey.execute>[0]) {
    requireAdminAction('tenant_config.manage');
    return tenantConfigRoutes.operations.putByTypeByKey.execute(context);
  }
}

@Injectable()
export class TenantConfigDeleteByTypeByKeyAction {
  execute(context: Parameters<typeof tenantConfigRoutes.operations.deleteByTypeByKey.execute>[0]) {
    requireAdminAction('tenant_config.manage');
    return tenantConfigRoutes.operations.deleteByTypeByKey.execute(context);
  }
}

@Injectable()
export class TenantConfigPostDomainByDomainCheckAction {
  execute(context: Parameters<typeof tenantConfigRoutes.operations.postDomainByDomainCheck.execute>[0]) {
    requireAdminAction('tenant_config.manage');
    return tenantConfigRoutes.operations.postDomainByDomainCheck.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/tenant-config")
export class TenantConfigController {
  constructor(
    private readonly putByTypeByKeyAction: TenantConfigPutByTypeByKeyAction,
    private readonly deleteByTypeByKeyAction: TenantConfigDeleteByTypeByKeyAction,
    private readonly postDomainByDomainCheckAction: TenantConfigPostDomainByDomainCheckAction,
  ) {}

  @Get("/", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/tenant-config.ts#getRoot" },
    aspects: [adminHttpAspect],
  })
  getRoot(ctx: HttpInvocation): Promise<Response> {
    return tenantConfigRoutes.operations.getRoot.invoke(ctx);
  }

  @Get("/:type/:key", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/tenant-config.ts#getByTypeByKey" },
    aspects: [adminHttpAspect],
  })
  getByTypeByKey(ctx: HttpInvocation): Promise<Response> {
    return tenantConfigRoutes.operations.getByTypeByKey.invoke(ctx);
  }

  @Put("/:type/:key", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/tenant-config.ts#putByTypeByKey" },
    aspects: [adminHttpAspect],
  })
  putByTypeByKey(ctx: HttpInvocation): Promise<Response> {
    return tenantConfigRoutes.operations.putByTypeByKey.invoke(ctx, context => this.putByTypeByKeyAction.execute(context));
  }

  @Delete("/:type/:key", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/tenant-config.ts#deleteByTypeByKey" },
    aspects: [adminHttpAspect],
  })
  deleteByTypeByKey(ctx: HttpInvocation): Promise<Response> {
    return tenantConfigRoutes.operations.deleteByTypeByKey.invoke(ctx, context => this.deleteByTypeByKeyAction.execute(context));
  }

  @Post("/domain/:domain/check", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/tenant-config.ts#postDomainByDomainCheck" },
    aspects: [adminHttpAspect],
  })
  postDomainByDomainCheck(ctx: HttpInvocation): Promise<Response> {
    return tenantConfigRoutes.operations.postDomainByDomainCheck.invoke(ctx, context => this.postDomainByDomainCheckAction.execute(context));
  }

}

export const TenantConfigModule = defineModule({
  name: 'supauth-tenant-config',
  tags: ['type:feature', 'scope:supauth-tenant-config'],
  providers: [TenantConfigPutByTypeByKeyAction, TenantConfigDeleteByTypeByKeyAction, TenantConfigPostDomainByDomainCheckAction],
  controllers: [TenantConfigController],
});
