import { Controller, defineModule, Injectable, Get, Post } from '@supacloud/app';
import { publicOAuthRoutes } from '../../routes/sign-in-experience.js';
import type { HttpInvocation } from '../../http/operation.js';

@Injectable({ scope: 'application' })
@Controller("/v1/public/oauth")
export class PublicOAuthController {
  @Get("/authorizations/:authorizationId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sign-in-experience.ts#getAuthorizationsByAuthorizationId" },
  })
  getAuthorizationsByAuthorizationId(ctx: HttpInvocation): Promise<Response> {
    return publicOAuthRoutes.operations.getAuthorizationsByAuthorizationId.invoke(ctx);
  }

  @Post("/authorizations/:authorizationId/consent", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sign-in-experience.ts#postAuthorizationsByAuthorizationIdConsent" },
  })
  postAuthorizationsByAuthorizationIdConsent(ctx: HttpInvocation): Promise<Response> {
    return publicOAuthRoutes.operations.postAuthorizationsByAuthorizationIdConsent.invoke(ctx);
  }

}

export const PublicOAuthModule = defineModule({
  name: 'supauth-public-oauth',
  tags: ['type:feature', 'scope:supauth-public-oauth'],
  providers: [],
  controllers: [PublicOAuthController],
});
