import { Controller, defineModule, Injectable, Post } from '@supacloud/app';
import { publicAccountPasswordRoutes } from '../../routes/account-password.js';
import type { HttpInvocation } from '../../http/operation.js';

@Injectable({ scope: 'application' })
@Controller("/v1/public/account-password")
export class PublicAccountPasswordController {
  @Post("/change", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-password.ts#postChange" },
  })
  postChange(ctx: HttpInvocation): Promise<Response> {
    return publicAccountPasswordRoutes.operations.postChange.invoke(ctx);
  }

}

export const PublicAccountPasswordModule = defineModule({
  name: 'supauth-public-account-password',
  tags: ['type:feature', 'scope:supauth-public-account-password'],
  providers: [],
  controllers: [PublicAccountPasswordController],
});
