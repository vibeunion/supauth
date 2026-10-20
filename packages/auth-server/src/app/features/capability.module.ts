import { Controller, defineModule, Injectable, Get } from '@supacloud/app';
import { capabilityRoutes } from '../../routes/capabilities.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect } from '../admin-aspect.js';

@Injectable({ scope: 'application' })
@Controller("/v1")
export class CapabilityController {
  @Get("/capabilities", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/capabilities.ts#getCapabilities" },
    aspects: [adminHttpAspect],
  })
  getCapabilities(ctx: HttpInvocation): Promise<Response> {
    return capabilityRoutes.operations.getCapabilities.invoke(ctx);
  }

}

export const CapabilityModule = defineModule({
  name: 'supauth-capability',
  tags: ['type:feature', 'scope:supauth-capability'],
  providers: [],
  controllers: [CapabilityController],
});
