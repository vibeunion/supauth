import { Controller, defineModule, Injectable, Get } from '@supacloud/app';
import { publicOauthSsoRoutes } from '../../routes/sso-authorize.js';
import type { HttpInvocation } from '../../http/operation.js';

@Injectable({ scope: 'application' })
@Controller("/v1/public/oauth/sso")
export class PublicOauthSsoController {
  @Get("/authorize", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sso-authorize.ts#getAuthorize" },
  })
  getAuthorize(ctx: HttpInvocation): Promise<Response> {
    return publicOauthSsoRoutes.operations.getAuthorize.invoke(ctx);
  }

}

export const PublicOauthSsoModule = defineModule({
  name: 'supauth-public-oauth-sso',
  tags: ['type:feature', 'scope:supauth-public-oauth-sso'],
  providers: [],
  controllers: [PublicOauthSsoController],
});
