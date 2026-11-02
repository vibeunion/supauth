import { Controller, defineModule, Injectable, Get } from '@supacloud/app';
import { publicSignInExperienceRoutes } from '../../routes/sign-in-experience.js';
import type { HttpInvocation } from '../../http/operation.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable({ scope: 'application' })
@Controller("/v1/public/sign-in-experience")
export class PublicSignInExperienceController {
  @Get("/resolve", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sign-in-experience.ts#getResolve" },
  })
  getResolve(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicSignInExperienceRoutes.operations.getResolve.invoke(ctx));
  }

}

export const PublicSignInExperienceModule = defineModule({
  name: 'supauth-public-sign-in-experience',
  tags: ['type:feature', 'scope:supauth-public-sign-in-experience'],
  providers: [],
  controllers: [PublicSignInExperienceController],
});
