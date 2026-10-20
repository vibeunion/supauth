import { Controller, defineModule, Injectable, Get } from '@supacloud/app';
import { publicSignInExperienceRoutes } from '../../routes/sign-in-experience.js';
import type { HttpInvocation } from '../../http/operation.js';

@Injectable({ scope: 'application' })
@Controller("/v1/public/sign-in-experience")
export class PublicSignInExperienceController {
  @Get("/resolve", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sign-in-experience.ts#getResolve" },
  })
  getResolve(ctx: HttpInvocation): Promise<Response> {
    return publicSignInExperienceRoutes.operations.getResolve.invoke(ctx);
  }

}

export const PublicSignInExperienceModule = defineModule({
  name: 'supauth-public-sign-in-experience',
  tags: ['type:feature', 'scope:supauth-public-sign-in-experience'],
  providers: [],
  controllers: [PublicSignInExperienceController],
});
