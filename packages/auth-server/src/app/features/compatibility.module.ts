import { Controller, defineModule, Injectable, Get } from '@supacloud/app';
import { compatibilityRoutes } from '../../routes/compatibility.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect } from '../admin-aspect.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable({ scope: 'application' })
@Controller("/v1/compatibility")
export class CompatibilityController {
  @Get("/supabase", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/compatibility.ts#getSupabase" },
    aspects: [adminHttpAspect],
  })
  getSupabase(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => compatibilityRoutes.operations.getSupabase.invoke(ctx));
  }

}

export const CompatibilityModule = defineModule({
  name: 'supauth-compatibility',
  tags: ['type:feature', 'scope:supauth-compatibility'],
  providers: [],
  controllers: [CompatibilityController],
});
