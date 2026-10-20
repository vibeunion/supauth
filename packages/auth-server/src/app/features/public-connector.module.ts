import { Controller, defineModule, Injectable, Get } from '@supacloud/app';
import { publicConnectorRoutes } from '../../routes/sign-in-experience.js';
import type { HttpInvocation } from '../../http/operation.js';

@Injectable({ scope: 'application' })
@Controller("/v1/public/connectors")
export class PublicConnectorController {
  @Get("/:connectorId/authorize", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sign-in-experience.ts#getByConnectorIdAuthorize" },
  })
  getByConnectorIdAuthorize(ctx: HttpInvocation): Promise<Response> {
    return publicConnectorRoutes.operations.getByConnectorIdAuthorize.invoke(ctx);
  }

}

export const PublicConnectorModule = defineModule({
  name: 'supauth-public-connector',
  tags: ['type:feature', 'scope:supauth-public-connector'],
  providers: [],
  controllers: [PublicConnectorController],
});
