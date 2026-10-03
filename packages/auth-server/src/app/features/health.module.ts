import { Controller, defineModule, Injectable, Get } from '@supacloud/app';
import { healthRoutes } from '../../routes/health.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect } from '../admin-aspect.js';

@Injectable({ scope: 'application' })
@Controller("/v1")
export class HealthController {
  @Get("/health", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/health.ts#getHealth" },
    aspects: [adminHttpAspect],
  })
  getHealth(ctx: HttpInvocation): Promise<Response> {
    return healthRoutes.operations.getHealth.invoke(ctx);
  }

  @Get("/project", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/health.ts#getProject" },
    aspects: [adminHttpAspect],
  })
  getProject(ctx: HttpInvocation): Promise<Response> {
    return healthRoutes.operations.getProject.invoke(ctx);
  }

  @Get("/public/admin-sso-config", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/health.ts#getPublicAdminSsoConfig" },
    aspects: [adminHttpAspect],
  })
  getPublicAdminSsoConfig(ctx: HttpInvocation): Promise<Response> {
    return healthRoutes.operations.getPublicAdminSsoConfig.invoke(ctx);
  }

}

export const HealthModule = defineModule({
  name: 'supauth-health',
  tags: ['type:feature', 'scope:supauth-health'],
  providers: [],
  controllers: [HealthController],
});
