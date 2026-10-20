import { Controller, defineModule, Injectable, Get } from '@supacloud/app';
import { compatibilityRoutes } from '../../routes/compatibility.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect } from '../admin-aspect.js';

@Injectable({ scope: 'application' })
@Controller("/v1/compatibility")
export class CompatibilityController {
  @Get("/supabase", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/compatibility.ts#getSupabase" },
    aspects: [adminHttpAspect],
  })
  getSupabase(ctx: HttpInvocation): Promise<Response> {
    return compatibilityRoutes.operations.getSupabase.invoke(ctx);
  }

}

export const CompatibilityModule = defineModule({
  name: 'supauth-compatibility',
  tags: ['type:feature', 'scope:supauth-compatibility'],
  providers: [],
  controllers: [CompatibilityController],
});
