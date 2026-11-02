import { Controller, defineModule, Injectable, Get } from '@supacloud/app';
import { publicOauthSsoRoutes } from '../../routes/sso-authorize.js';
import type { HttpInvocation } from '../../http/operation.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable({ scope: 'application' })
@Controller("/v1/public/oauth/sso")
export class PublicOauthSsoController {
  @Get("/authorize", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sso-authorize.ts#getAuthorize" },
  })
  getAuthorize(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicOauthSsoRoutes.operations.getAuthorize.invoke(ctx));
  }

}

export const PublicOauthSsoModule = defineModule({
  name: 'supauth-public-oauth-sso',
  tags: ['type:feature', 'scope:supauth-public-oauth-sso'],
  providers: [],
  controllers: [PublicOauthSsoController],
});
