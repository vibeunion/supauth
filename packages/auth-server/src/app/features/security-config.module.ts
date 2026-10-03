import { Controller, defineModule, Injectable, Get, Put } from '@supacloud/app';
import { securityConfigRoutes } from '../../routes/security-config.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';

@Injectable()
export class SecurityConfigPutRootAction {
  execute(context: Parameters<typeof securityConfigRoutes.operations.putRoot.execute>[0]) {
    requireAdminAction('security.manage');
    return securityConfigRoutes.operations.putRoot.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/security-config")
export class SecurityConfigController {
  constructor(
    private readonly putRootAction: SecurityConfigPutRootAction,
  ) {}

  @Get("/", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/security-config.ts#getRoot" },
    aspects: [adminHttpAspect],
  })
  getRoot(ctx: HttpInvocation): Promise<Response> {
    return securityConfigRoutes.operations.getRoot.invoke(ctx);
  }

  @Put("/", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/security-config.ts#putRoot" },
    aspects: [adminHttpAspect],
  })
  putRoot(ctx: HttpInvocation): Promise<Response> {
    return securityConfigRoutes.operations.putRoot.invoke(ctx, context => this.putRootAction.execute(context));
  }

  @Get("/status", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/security-config.ts#getStatus" },
    aspects: [adminHttpAspect],
  })
  getStatus(ctx: HttpInvocation): Promise<Response> {
    return securityConfigRoutes.operations.getStatus.invoke(ctx);
  }

}

export const SecurityConfigModule = defineModule({
  name: 'supauth-security-config',
  tags: ['type:feature', 'scope:supauth-security-config'],
  providers: [SecurityConfigPutRootAction],
  controllers: [SecurityConfigController],
});
