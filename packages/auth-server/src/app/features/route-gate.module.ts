import { Controller, defineModule, Injectable, Get } from '@supacloud/app';
import { routeGateRoutes } from '../../routes/route-gate.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect } from '../admin-aspect.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable({ scope: 'application' })
@Controller("/v1/route-gate")
export class RouteGateController {
  @Get("/", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/route-gate.ts#getRoot" },
    aspects: [adminHttpAspect],
  })
  getRoot(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => routeGateRoutes.operations.getRoot.invoke(ctx));
  }

  @Get("/routes", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/route-gate.ts#getRoutes" },
    aspects: [adminHttpAspect],
  })
  getRoutes(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => routeGateRoutes.operations.getRoutes.invoke(ctx));
  }

}

export const RouteGateModule = defineModule({
  name: 'supauth-route-gate',
  tags: ['type:feature', 'scope:supauth-route-gate'],
  providers: [],
  controllers: [RouteGateController],
});
