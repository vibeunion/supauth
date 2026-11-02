import { Controller, defineModule, Injectable, Get } from '@supacloud/app';
import { oauthSsoRoutes } from '../../routes/sso-authorize.js';
import type { HttpInvocation } from '../../http/operation.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable({ scope: 'application' })
@Controller("/oauth/sso")
export class OauthSsoController {
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
    return routeEffect(() => oauthSsoRoutes.operations.getAuthorize.invoke(ctx));
  }

}

export const OauthSsoModule = defineModule({
  name: 'supauth-oauth-sso',
  tags: ['type:feature', 'scope:supauth-oauth-sso'],
  providers: [],
  controllers: [OauthSsoController],
});
