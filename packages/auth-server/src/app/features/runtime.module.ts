import { Controller, defineModule, Injectable, Get } from '@supacloud/app';
import { runtimeRoutes } from '../../routes/health.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect } from '../admin-aspect.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable({ scope: 'application' })
@Controller("/v1/runtime")
export class RuntimeController {
  @Get("/health", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/health.ts#getHealth" },
    aspects: [adminHttpAspect],
  })
  getHealth(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => runtimeRoutes.operations.getHealth.invoke(ctx));
  }

  @Get("/oauth-server", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/health.ts#getOauthServer" },
    aspects: [adminHttpAspect],
  })
  getOauthServer(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => runtimeRoutes.operations.getOauthServer.invoke(ctx));
  }

  @Get("/discovery", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/health.ts#getDiscovery" },
    aspects: [adminHttpAspect],
  })
  getDiscovery(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => runtimeRoutes.operations.getDiscovery.invoke(ctx));
  }

  @Get("/jwks", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/health.ts#getJwks" },
    aspects: [adminHttpAspect],
  })
  getJwks(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => runtimeRoutes.operations.getJwks.invoke(ctx));
  }

}

export const RuntimeModule = defineModule({
  name: 'supauth-runtime',
  tags: ['type:feature', 'scope:supauth-runtime'],
  providers: [],
  controllers: [RuntimeController],
});
