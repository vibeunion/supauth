import { Controller, defineModule, Injectable, Get } from '@supacloud/app';
import { routeGateRoutes } from '../../routes/route-gate.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect } from '../admin-aspect.js';

@Injectable({ scope: 'application' })
@Controller("/v1/route-gate")
export class RouteGateController {
  @Get("/", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/route-gate.ts#getRoot" },
    aspects: [adminHttpAspect],
  })
  getRoot(ctx: HttpInvocation): Promise<Response> {
    return routeGateRoutes.operations.getRoot.invoke(ctx);
  }

  @Get("/routes", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/route-gate.ts#getRoutes" },
    aspects: [adminHttpAspect],
  })
  getRoutes(ctx: HttpInvocation): Promise<Response> {
    return routeGateRoutes.operations.getRoutes.invoke(ctx);
  }

}

export const RouteGateModule = defineModule({
  name: 'supauth-route-gate',
  tags: ['type:feature', 'scope:supauth-route-gate'],
  providers: [],
  controllers: [RouteGateController],
});
