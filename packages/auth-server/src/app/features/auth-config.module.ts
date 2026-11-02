import { Controller, defineModule, Injectable, Get, Patch } from '@supacloud/app';
import { authConfigRoutes } from '../../routes/sign-in-experience.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable()
export class AuthConfigPatchRootAction {
  execute(context: Parameters<typeof authConfigRoutes.operations.patchRoot.execute>[0]) {
    requireAdminAction('security.manage');
    return authConfigRoutes.operations.patchRoot.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/auth-config")
export class AuthConfigController {
  constructor(
    private readonly patchRootAction: AuthConfigPatchRootAction,
  ) {}

  @Get("/", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sign-in-experience.ts#getRoot" },
    aspects: [adminHttpAspect],
  })
  getRoot(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => authConfigRoutes.operations.getRoot.invoke(ctx));
  }

  @Get("/runtime-consistency", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sign-in-experience.ts#getRuntimeConsistency" },
    aspects: [adminHttpAspect],
  })
  getRuntimeConsistency(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => authConfigRoutes.operations.getRuntimeConsistency.invoke(ctx));
  }

  @Patch("/", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sign-in-experience.ts#patchRoot" },
    aspects: [adminHttpAspect],
  })
  patchRoot(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => authConfigRoutes.operations.patchRoot.invoke(ctx, context => this.patchRootAction.execute(context)));
  }

}

export const AuthConfigModule = defineModule({
  name: 'supauth-auth-config',
  tags: ['type:feature', 'scope:supauth-auth-config'],
  providers: [AuthConfigPatchRootAction],
  controllers: [AuthConfigController],
});
