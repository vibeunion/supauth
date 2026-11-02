import { Controller, defineModule, Injectable, Get, Post } from '@supacloud/app';
import { publicOAuthRoutes } from '../../routes/sign-in-experience.js';
import type { HttpInvocation } from '../../http/operation.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable({ scope: 'application' })
@Controller("/v1/public/oauth")
export class PublicOAuthController {
  @Get("/authorizations/:authorizationId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sign-in-experience.ts#getAuthorizationsByAuthorizationId" },
  })
  getAuthorizationsByAuthorizationId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicOAuthRoutes.operations.getAuthorizationsByAuthorizationId.invoke(ctx));
  }

  @Post("/authorizations/:authorizationId/consent", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sign-in-experience.ts#postAuthorizationsByAuthorizationIdConsent" },
  })
  postAuthorizationsByAuthorizationIdConsent(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicOAuthRoutes.operations.postAuthorizationsByAuthorizationIdConsent.invoke(ctx));
  }

}

export const PublicOAuthModule = defineModule({
  name: 'supauth-public-oauth',
  tags: ['type:feature', 'scope:supauth-public-oauth'],
  providers: [],
  controllers: [PublicOAuthController],
});
