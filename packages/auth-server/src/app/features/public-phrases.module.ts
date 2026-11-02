import { Controller, defineModule, Injectable, Get } from '@supacloud/app';
import { publicPhrasesRoutes } from '../../routes/sign-in-experience.js';
import type { HttpInvocation } from '../../http/operation.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable({ scope: 'application' })
@Controller("/v1/public/phrases")
export class PublicPhrasesController {
  @Get("/:languageTag", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sign-in-experience.ts#getByLanguageTag" },
  })
  getByLanguageTag(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicPhrasesRoutes.operations.getByLanguageTag.invoke(ctx));
  }

}

export const PublicPhrasesModule = defineModule({
  name: 'supauth-public-phrases',
  tags: ['type:feature', 'scope:supauth-public-phrases'],
  providers: [],
  controllers: [PublicPhrasesController],
});
