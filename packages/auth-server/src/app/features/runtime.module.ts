import { Controller, defineModule, Injectable, Get } from '@supacloud/app';
import { runtimeRoutes } from '../../routes/health.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect } from '../admin-aspect.js';

@Injectable({ scope: 'application' })
@Controller("/v1/runtime")
export class RuntimeController {
  @Get("/health", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/health.ts#getHealth" },
    aspects: [adminHttpAspect],
  })
  getHealth(ctx: HttpInvocation): Promise<Response> {
    return runtimeRoutes.operations.getHealth.invoke(ctx);
  }

  @Get("/oauth-server", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/health.ts#getOauthServer" },
    aspects: [adminHttpAspect],
  })
  getOauthServer(ctx: HttpInvocation): Promise<Response> {
    return runtimeRoutes.operations.getOauthServer.invoke(ctx);
  }

  @Get("/discovery", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/health.ts#getDiscovery" },
    aspects: [adminHttpAspect],
  })
  getDiscovery(ctx: HttpInvocation): Promise<Response> {
    return runtimeRoutes.operations.getDiscovery.invoke(ctx);
  }

  @Get("/jwks", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/health.ts#getJwks" },
    aspects: [adminHttpAspect],
  })
  getJwks(ctx: HttpInvocation): Promise<Response> {
    return runtimeRoutes.operations.getJwks.invoke(ctx);
  }

}

export const RuntimeModule = defineModule({
  name: 'supauth-runtime',
  tags: ['type:feature', 'scope:supauth-runtime'],
  providers: [],
  controllers: [RuntimeController],
});
