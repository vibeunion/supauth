import { Controller, defineModule, Injectable, Get, Patch } from '@supacloud/app';
import { authConfigRoutes } from '../../routes/sign-in-experience.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';

@Injectable()
export class AuthConfigPatchRootAction {
  execute(context: Parameters<typeof authConfigRoutes.operations.patchRoot.execute>[0]) {
    requireAdminAction('security.manage');
    return authConfigRoutes.operations.patchRoot.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/auth-config")
export class AuthConfigController {
  constructor(
    private readonly patchRootAction: AuthConfigPatchRootAction,
  ) {}

  @Get("/", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sign-in-experience.ts#getRoot" },
    aspects: [adminHttpAspect],
  })
  getRoot(ctx: HttpInvocation): Promise<Response> {
    return authConfigRoutes.operations.getRoot.invoke(ctx);
  }

  @Get("/runtime-consistency", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sign-in-experience.ts#getRuntimeConsistency" },
    aspects: [adminHttpAspect],
  })
  getRuntimeConsistency(ctx: HttpInvocation): Promise<Response> {
    return authConfigRoutes.operations.getRuntimeConsistency.invoke(ctx);
  }

  @Patch("/", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sign-in-experience.ts#patchRoot" },
    aspects: [adminHttpAspect],
  })
  patchRoot(ctx: HttpInvocation): Promise<Response> {
    return authConfigRoutes.operations.patchRoot.invoke(ctx, context => this.patchRootAction.execute(context));
  }

}

export const AuthConfigModule = defineModule({
  name: 'supauth-auth-config',
  tags: ['type:feature', 'scope:supauth-auth-config'],
  providers: [AuthConfigPatchRootAction],
  controllers: [AuthConfigController],
});
