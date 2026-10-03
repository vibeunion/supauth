import { Controller, defineModule, Injectable, Get, Post } from '@supacloud/app';
import { publicAccountClaimRoutes } from '../../routes/account-provisioning.js';
import type { HttpInvocation } from '../../http/operation.js';

@Injectable({ scope: 'application' })
@Controller("/v1/public/account-claims")
export class PublicAccountClaimController {
  @Get("/config", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-provisioning.ts#getConfig" },
  })
  getConfig(ctx: HttpInvocation): Promise<Response> {
    return publicAccountClaimRoutes.operations.getConfig.invoke(ctx);
  }

  @Post("/claim", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-provisioning.ts#postClaim" },
  })
  postClaim(ctx: HttpInvocation): Promise<Response> {
    return publicAccountClaimRoutes.operations.postClaim.invoke(ctx);
  }

}

export const PublicAccountClaimModule = defineModule({
  name: 'supauth-public-account-claim',
  tags: ['type:feature', 'scope:supauth-public-account-claim'],
  providers: [],
  controllers: [PublicAccountClaimController],
});
