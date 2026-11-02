import { Controller, defineModule, Injectable, Post, Get } from '@supacloud/app';
import { authRoutes } from '../../auth/index.js';
import type { HttpInvocation } from '../../http/operation.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable({ scope: 'application' })
@Controller("/v1/auth")
export class AuthController {
  @Post("/login", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/auth/index.ts#postLogin" },
  })
  postLogin(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => authRoutes.operations.postLogin.invoke(ctx));
  }

  @Post("/logout", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/auth/index.ts#postLogout" },
  })
  postLogout(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => authRoutes.operations.postLogout.invoke(ctx));
  }

  @Get("/identity", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/auth/index.ts#getIdentity" },
  })
  getIdentity(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => authRoutes.operations.getIdentity.invoke(ctx));
  }

  @Get("/health", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/auth/index.ts#getHealth" },
  })
  getHealth(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => authRoutes.operations.getHealth.invoke(ctx));
  }

}

export const AuthModule = defineModule({
  name: 'supauth-auth',
  tags: ['type:feature', 'scope:supauth-auth'],
  providers: [],
  controllers: [AuthController],
});
