import { Controller, defineModule, Injectable, Get } from '@supacloud/app';
import { publicCustomUiRoutes } from '../../routes/sign-in-experience.js';
import type { HttpInvocation } from '../../http/operation.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable({ scope: 'application' })
@Controller("/v1/public/custom-ui")
export class PublicCustomUiController {
  @Get("/*", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sign-in-experience.ts#getWildcard" },
  })
  getWildcard(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicCustomUiRoutes.operations.getWildcard.invoke(ctx));
  }

}

export const PublicCustomUiModule = defineModule({
  name: 'supauth-public-custom-ui',
  tags: ['type:feature', 'scope:supauth-public-custom-ui'],
  providers: [],
  controllers: [PublicCustomUiController],
});
