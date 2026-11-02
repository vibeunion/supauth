import { Controller, defineModule, Injectable, Get, Post } from '@supacloud/app';
import { rbacBridgeRoutes } from '../../routes/rbac-bridge.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable()
export class RbacBridgePostDryRunAction {
  execute(context: Parameters<typeof rbacBridgeRoutes.operations.postDryRun.execute>[0]) {
    requireAdminAction('operations.manage');
    return rbacBridgeRoutes.operations.postDryRun.execute(context);
  }
}

@Injectable()
export class RbacBridgePostImportAction {
  execute(context: Parameters<typeof rbacBridgeRoutes.operations.postImport.execute>[0]) {
    requireAdminAction('operations.manage');
    return rbacBridgeRoutes.operations.postImport.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/rbac-bridge")
export class RbacBridgeController {
  constructor(
    private readonly postDryRunAction: RbacBridgePostDryRunAction,
    private readonly postImportAction: RbacBridgePostImportAction,
  ) {}

  @Get("/default-policy", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/rbac-bridge.ts#getDefaultPolicy" },
    aspects: [adminHttpAspect],
  })
  getDefaultPolicy(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => rbacBridgeRoutes.operations.getDefaultPolicy.invoke(ctx));
  }

  @Post("/dry-run", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/rbac-bridge.ts#postDryRun" },
    aspects: [adminHttpAspect],
  })
  postDryRun(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => rbacBridgeRoutes.operations.postDryRun.invoke(ctx, context => this.postDryRunAction.execute(context)));
  }

  @Post("/import", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/rbac-bridge.ts#postImport" },
    aspects: [adminHttpAspect],
  })
  postImport(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => rbacBridgeRoutes.operations.postImport.invoke(ctx, context => this.postImportAction.execute(context)));
  }

  @Get("/compatibility-helper", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/rbac-bridge.ts#getCompatibilityHelper" },
    aspects: [adminHttpAspect],
  })
  getCompatibilityHelper(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => rbacBridgeRoutes.operations.getCompatibilityHelper.invoke(ctx));
  }

}

export const RbacBridgeModule = defineModule({
  name: 'supauth-rbac-bridge',
  tags: ['type:feature', 'scope:supauth-rbac-bridge'],
  providers: [RbacBridgePostDryRunAction, RbacBridgePostImportAction],
  controllers: [RbacBridgeController],
});
