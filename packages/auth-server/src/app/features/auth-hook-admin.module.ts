import { Controller, defineModule, Injectable, Get, Patch, Post } from '@supacloud/app';
import { authHookAdminRoutes } from '../../routes/auth-hooks.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable()
export class AuthHookAdminPatchCustomAccessTokenConfigAction {
  execute(context: Parameters<typeof authHookAdminRoutes.operations.patchCustomAccessTokenConfig.execute>[0]) {
    requireAdminAction('security.manage');
    return authHookAdminRoutes.operations.patchCustomAccessTokenConfig.execute(context);
  }
}

@Injectable()
export class AuthHookAdminPostCustomAccessTokenVerifyAction {
  execute(context: Parameters<typeof authHookAdminRoutes.operations.postCustomAccessTokenVerify.execute>[0]) {
    requireAdminAction('security.manage');
    return authHookAdminRoutes.operations.postCustomAccessTokenVerify.execute(context);
  }
}

@Injectable()
export class AuthHookAdminPostBeforeUserCreatedVerifyAction {
  execute(context: Parameters<typeof authHookAdminRoutes.operations.postBeforeUserCreatedVerify.execute>[0]) {
    requireAdminAction('security.manage');
    return authHookAdminRoutes.operations.postBeforeUserCreatedVerify.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/auth-hooks")
export class AuthHookAdminController {
  constructor(
    private readonly patchCustomAccessTokenConfigAction: AuthHookAdminPatchCustomAccessTokenConfigAction,
    private readonly postCustomAccessTokenVerifyAction: AuthHookAdminPostCustomAccessTokenVerifyAction,
    private readonly postBeforeUserCreatedVerifyAction: AuthHookAdminPostBeforeUserCreatedVerifyAction,
  ) {}

  @Get("/registration-guide", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/auth-hooks.ts#getRegistrationGuide" },
    aspects: [adminHttpAspect],
  })
  getRegistrationGuide(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => authHookAdminRoutes.operations.getRegistrationGuide.invoke(ctx));
  }

  @Get("/custom-access-token/status", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/auth-hooks.ts#getCustomAccessTokenStatus" },
    aspects: [adminHttpAspect],
  })
  getCustomAccessTokenStatus(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => authHookAdminRoutes.operations.getCustomAccessTokenStatus.invoke(ctx));
  }

  @Get("/custom-access-token/config", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/auth-hooks.ts#getCustomAccessTokenConfig" },
    aspects: [adminHttpAspect],
  })
  getCustomAccessTokenConfig(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => authHookAdminRoutes.operations.getCustomAccessTokenConfig.invoke(ctx));
  }

  @Patch("/custom-access-token/config", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/auth-hooks.ts#patchCustomAccessTokenConfig" },
    aspects: [adminHttpAspect],
  })
  patchCustomAccessTokenConfig(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => authHookAdminRoutes.operations.patchCustomAccessTokenConfig.invoke(ctx, context => this.patchCustomAccessTokenConfigAction.execute(context)));
  }

  @Post("/custom-access-token/verify", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/auth-hooks.ts#postCustomAccessTokenVerify" },
    aspects: [adminHttpAspect],
  })
  postCustomAccessTokenVerify(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => authHookAdminRoutes.operations.postCustomAccessTokenVerify.invoke(ctx, context => this.postCustomAccessTokenVerifyAction.execute(context)));
  }

  @Get("/before-user-created/status", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/auth-hooks.ts#getBeforeUserCreatedStatus" },
    aspects: [adminHttpAspect],
  })
  getBeforeUserCreatedStatus(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => authHookAdminRoutes.operations.getBeforeUserCreatedStatus.invoke(ctx));
  }

  @Post("/before-user-created/verify", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/auth-hooks.ts#postBeforeUserCreatedVerify" },
    aspects: [adminHttpAspect],
  })
  postBeforeUserCreatedVerify(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => authHookAdminRoutes.operations.postBeforeUserCreatedVerify.invoke(ctx, context => this.postBeforeUserCreatedVerifyAction.execute(context)));
  }

}

export const AuthHookAdminModule = defineModule({
  name: 'supauth-auth-hook-admin',
  tags: ['type:feature', 'scope:supauth-auth-hook-admin'],
  providers: [AuthHookAdminPatchCustomAccessTokenConfigAction, AuthHookAdminPostCustomAccessTokenVerifyAction, AuthHookAdminPostBeforeUserCreatedVerifyAction],
  controllers: [AuthHookAdminController],
});
