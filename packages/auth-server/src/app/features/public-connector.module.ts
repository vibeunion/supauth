import { Controller, defineModule, Injectable, Get } from '@supacloud/app';
import { publicConnectorRoutes } from '../../routes/sign-in-experience.js';
import type { HttpInvocation } from '../../http/operation.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable({ scope: 'application' })
@Controller("/v1/public/connectors")
export class PublicConnectorController {
  @Get("/:connectorId/authorize", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sign-in-experience.ts#getByConnectorIdAuthorize" },
  })
  getByConnectorIdAuthorize(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicConnectorRoutes.operations.getByConnectorIdAuthorize.invoke(ctx));
  }

}

export const PublicConnectorModule = defineModule({
  name: 'supauth-public-connector',
  tags: ['type:feature', 'scope:supauth-public-connector'],
  providers: [],
  controllers: [PublicConnectorController],
});
