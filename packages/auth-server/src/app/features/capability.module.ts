import { Controller, defineModule, Injectable, Get } from '@supacloud/app';
import { capabilityRoutes } from '../../routes/capabilities.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect } from '../admin-aspect.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable({ scope: 'application' })
@Controller("/v1")
export class CapabilityController {
  @Get("/capabilities", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/capabilities.ts#getCapabilities" },
    aspects: [adminHttpAspect],
  })
  getCapabilities(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => capabilityRoutes.operations.getCapabilities.invoke(ctx));
  }

}

export const CapabilityModule = defineModule({
  name: 'supauth-capability',
  tags: ['type:feature', 'scope:supauth-capability'],
  providers: [],
  controllers: [CapabilityController],
});
