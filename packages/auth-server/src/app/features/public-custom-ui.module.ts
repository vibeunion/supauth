import { Controller, defineModule, Injectable, Get } from '@supacloud/app';
import { publicCustomUiRoutes } from '../../routes/sign-in-experience.js';
import type { HttpInvocation } from '../../http/operation.js';

@Injectable({ scope: 'application' })
@Controller("/v1/public/custom-ui")
export class PublicCustomUiController {
  @Get("/*", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sign-in-experience.ts#getWildcard" },
  })
  getWildcard(ctx: HttpInvocation): Promise<Response> {
    return publicCustomUiRoutes.operations.getWildcard.invoke(ctx);
  }

}

export const PublicCustomUiModule = defineModule({
  name: 'supauth-public-custom-ui',
  tags: ['type:feature', 'scope:supauth-public-custom-ui'],
  providers: [],
  controllers: [PublicCustomUiController],
});
