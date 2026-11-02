import { Controller, defineModule, Injectable, Get, Post } from '@supacloud/app';
import { apiVersionRoutes } from '../../routes/api-versions.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable()
export class ApiVersionPostRootAction {
  execute(context: Parameters<typeof apiVersionRoutes.operations.postRoot.execute>[0]) {
    requireAdminAction('operations.manage');
    return apiVersionRoutes.operations.postRoot.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/api-versions")
export class ApiVersionController {
  constructor(
    private readonly postRootAction: ApiVersionPostRootAction,
  ) {}

  @Get("/", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/api-versions.ts#getRoot" },
    aspects: [adminHttpAspect],
  })
  getRoot(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => apiVersionRoutes.operations.getRoot.invoke(ctx));
  }

  @Get("/:version", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/api-versions.ts#getByVersion" },
    aspects: [adminHttpAspect],
  })
  getByVersion(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => apiVersionRoutes.operations.getByVersion.invoke(ctx));
  }

  @Post("/", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/api-versions.ts#postRoot" },
    aspects: [adminHttpAspect],
  })
  postRoot(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => apiVersionRoutes.operations.postRoot.invoke(ctx, context => this.postRootAction.execute(context)));
  }

}

export const ApiVersionModule = defineModule({
  name: 'supauth-api-version',
  tags: ['type:feature', 'scope:supauth-api-version'],
  providers: [ApiVersionPostRootAction],
  controllers: [ApiVersionController],
});
