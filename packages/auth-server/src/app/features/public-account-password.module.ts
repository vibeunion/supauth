import { Controller, defineModule, Injectable, Post } from '@supacloud/app';
import { publicAccountPasswordRoutes } from '../../routes/account-password.js';
import type { HttpInvocation } from '../../http/operation.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable({ scope: 'application' })
@Controller("/v1/public/account-password")
export class PublicAccountPasswordController {
  @Post("/change", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-password.ts#postChange" },
  })
  postChange(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicAccountPasswordRoutes.operations.postChange.invoke(ctx));
  }

}

export const PublicAccountPasswordModule = defineModule({
  name: 'supauth-public-account-password',
  tags: ['type:feature', 'scope:supauth-public-account-password'],
  providers: [],
  controllers: [PublicAccountPasswordController],
});
