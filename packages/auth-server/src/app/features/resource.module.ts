import { Controller, defineModule, Injectable, Get, Post, Put, Delete } from '@supacloud/app';
import { resourceRoutes } from '../../routes/resources.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';

@Injectable()
export class ResourcePostRootAction {
  execute(context: Parameters<typeof resourceRoutes.operations.postRoot.execute>[0]) {
    requireAdminAction('api_resources.manage');
    return resourceRoutes.operations.postRoot.execute(context);
  }
}

@Injectable()
export class ResourcePutByResourceIdAction {
  execute(context: Parameters<typeof resourceRoutes.operations.putByResourceId.execute>[0]) {
    requireAdminAction('api_resources.manage');
    return resourceRoutes.operations.putByResourceId.execute(context);
  }
}

@Injectable()
export class ResourceDeleteByResourceIdAction {
  execute(context: Parameters<typeof resourceRoutes.operations.deleteByResourceId.execute>[0]) {
    requireAdminAction('api_resources.manage');
    return resourceRoutes.operations.deleteByResourceId.execute(context);
  }
}

@Injectable()
export class ResourcePostByResourceIdScopesAction {
  execute(context: Parameters<typeof resourceRoutes.operations.postByResourceIdScopes.execute>[0]) {
    requireAdminAction('api_resources.manage');
    return resourceRoutes.operations.postByResourceIdScopes.execute(context);
  }
}

@Injectable()
export class ResourcePutByResourceIdScopesByScopeIdAction {
  execute(context: Parameters<typeof resourceRoutes.operations.putByResourceIdScopesByScopeId.execute>[0]) {
    requireAdminAction('api_resources.manage');
    return resourceRoutes.operations.putByResourceIdScopesByScopeId.execute(context);
  }
}

@Injectable()
export class ResourceDeleteByResourceIdScopesByScopeIdAction {
  execute(context: Parameters<typeof resourceRoutes.operations.deleteByResourceIdScopesByScopeId.execute>[0]) {
    requireAdminAction('api_resources.manage');
    return resourceRoutes.operations.deleteByResourceIdScopesByScopeId.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/resources")
export class ResourceController {
  constructor(
    private readonly postRootAction: ResourcePostRootAction,
    private readonly putByResourceIdAction: ResourcePutByResourceIdAction,
    private readonly deleteByResourceIdAction: ResourceDeleteByResourceIdAction,
    private readonly postByResourceIdScopesAction: ResourcePostByResourceIdScopesAction,
    private readonly putByResourceIdScopesByScopeIdAction: ResourcePutByResourceIdScopesByScopeIdAction,
    private readonly deleteByResourceIdScopesByScopeIdAction: ResourceDeleteByResourceIdScopesByScopeIdAction,
  ) {}

  @Get("/", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/resources.ts#getRoot" },
    aspects: [adminHttpAspect],
  })
  getRoot(ctx: HttpInvocation): Promise<Response> {
    return resourceRoutes.operations.getRoot.invoke(ctx);
  }

  @Post("/", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/resources.ts#postRoot" },
    aspects: [adminHttpAspect],
  })
  postRoot(ctx: HttpInvocation): Promise<Response> {
    return resourceRoutes.operations.postRoot.invoke(ctx, context => this.postRootAction.execute(context));
  }

  @Get("/:resourceId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/resources.ts#getByResourceId" },
    aspects: [adminHttpAspect],
  })
  getByResourceId(ctx: HttpInvocation): Promise<Response> {
    return resourceRoutes.operations.getByResourceId.invoke(ctx);
  }

  @Put("/:resourceId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/resources.ts#putByResourceId" },
    aspects: [adminHttpAspect],
  })
  putByResourceId(ctx: HttpInvocation): Promise<Response> {
    return resourceRoutes.operations.putByResourceId.invoke(ctx, context => this.putByResourceIdAction.execute(context));
  }

  @Delete("/:resourceId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/resources.ts#deleteByResourceId" },
    aspects: [adminHttpAspect],
  })
  deleteByResourceId(ctx: HttpInvocation): Promise<Response> {
    return resourceRoutes.operations.deleteByResourceId.invoke(ctx, context => this.deleteByResourceIdAction.execute(context));
  }

  @Post("/:resourceId/scopes", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/resources.ts#postByResourceIdScopes" },
    aspects: [adminHttpAspect],
  })
  postByResourceIdScopes(ctx: HttpInvocation): Promise<Response> {
    return resourceRoutes.operations.postByResourceIdScopes.invoke(ctx, context => this.postByResourceIdScopesAction.execute(context));
  }

  @Put("/:resourceId/scopes/:scopeId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/resources.ts#putByResourceIdScopesByScopeId" },
    aspects: [adminHttpAspect],
  })
  putByResourceIdScopesByScopeId(ctx: HttpInvocation): Promise<Response> {
    return resourceRoutes.operations.putByResourceIdScopesByScopeId.invoke(ctx, context => this.putByResourceIdScopesByScopeIdAction.execute(context));
  }

  @Delete("/:resourceId/scopes/:scopeId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/resources.ts#deleteByResourceIdScopesByScopeId" },
    aspects: [adminHttpAspect],
  })
  deleteByResourceIdScopesByScopeId(ctx: HttpInvocation): Promise<Response> {
    return resourceRoutes.operations.deleteByResourceIdScopesByScopeId.invoke(ctx, context => this.deleteByResourceIdScopesByScopeIdAction.execute(context));
  }

  @Get("/:resourceId/applications", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/resources.ts#getByResourceIdApplications" },
    aspects: [adminHttpAspect],
  })
  getByResourceIdApplications(ctx: HttpInvocation): Promise<Response> {
    return resourceRoutes.operations.getByResourceIdApplications.invoke(ctx);
  }

}

export const ResourceModule = defineModule({
  name: 'supauth-resource',
  tags: ['type:feature', 'scope:supauth-resource'],
  providers: [ResourcePostRootAction, ResourcePutByResourceIdAction, ResourceDeleteByResourceIdAction, ResourcePostByResourceIdScopesAction, ResourcePutByResourceIdScopesByScopeIdAction, ResourceDeleteByResourceIdScopesByScopeIdAction],
  controllers: [ResourceController],
});
