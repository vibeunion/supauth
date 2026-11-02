import { Controller, defineModule, Injectable, Post } from '@supacloud/app';
import { syncRoutes } from '../../routes/sync.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable()
export class SyncPostUserByUserIdAction {
  execute(context: Parameters<typeof syncRoutes.operations.postUserByUserId.execute>[0]) {
    requireAdminAction('operations.manage');
    return syncRoutes.operations.postUserByUserId.execute(context);
  }
}

@Injectable()
export class SyncPostOrgByOrgIdAction {
  execute(context: Parameters<typeof syncRoutes.operations.postOrgByOrgId.execute>[0]) {
    requireAdminAction('operations.manage');
    return syncRoutes.operations.postOrgByOrgId.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/sync")
export class SyncController {
  constructor(
    private readonly postUserByUserIdAction: SyncPostUserByUserIdAction,
    private readonly postOrgByOrgIdAction: SyncPostOrgByOrgIdAction,
  ) {}

  @Post("/user/:userId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sync.ts#postUserByUserId" },
    aspects: [adminHttpAspect],
  })
  postUserByUserId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => syncRoutes.operations.postUserByUserId.invoke(ctx, context => this.postUserByUserIdAction.execute(context)));
  }

  @Post("/org/:orgId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sync.ts#postOrgByOrgId" },
    aspects: [adminHttpAspect],
  })
  postOrgByOrgId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => syncRoutes.operations.postOrgByOrgId.invoke(ctx, context => this.postOrgByOrgIdAction.execute(context)));
  }

}

export const SyncModule = defineModule({
  name: 'supauth-sync',
  tags: ['type:feature', 'scope:supauth-sync'],
  providers: [SyncPostUserByUserIdAction, SyncPostOrgByOrgIdAction],
  controllers: [SyncController],
});
