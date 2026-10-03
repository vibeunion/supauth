import { Controller, defineModule, Injectable, Get } from '@supacloud/app';
import { publicPhrasesRoutes } from '../../routes/sign-in-experience.js';
import type { HttpInvocation } from '../../http/operation.js';

@Injectable({ scope: 'application' })
@Controller("/v1/public/phrases")
export class PublicPhrasesController {
  @Get("/:languageTag", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sign-in-experience.ts#getByLanguageTag" },
  })
  getByLanguageTag(ctx: HttpInvocation): Promise<Response> {
    return publicPhrasesRoutes.operations.getByLanguageTag.invoke(ctx);
  }

}

export const PublicPhrasesModule = defineModule({
  name: 'supauth-public-phrases',
  tags: ['type:feature', 'scope:supauth-public-phrases'],
  providers: [],
  controllers: [PublicPhrasesController],
});
