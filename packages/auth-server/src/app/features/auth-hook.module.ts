import { Controller, defineModule, Injectable, Post } from '@supacloud/app';
import { authHookRoutes } from '../../routes/auth-hooks.js';
import type { HttpInvocation } from '../../http/operation.js';

@Injectable({ scope: 'application' })
@Controller("/v1/auth-hooks")
export class AuthHookController {
  @Post("/before-user-created", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/auth-hooks.ts#postBeforeUserCreated" },
  })
  postBeforeUserCreated(ctx: HttpInvocation): Promise<Response> {
    return authHookRoutes.operations.postBeforeUserCreated.invoke(ctx);
  }

  @Post("/custom-access-token", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/auth-hooks.ts#postCustomAccessToken" },
  })
  postCustomAccessToken(ctx: HttpInvocation): Promise<Response> {
    return authHookRoutes.operations.postCustomAccessToken.invoke(ctx);
  }

}

export const AuthHookModule = defineModule({
  name: 'supauth-auth-hook',
  tags: ['type:feature', 'scope:supauth-auth-hook'],
  providers: [],
  controllers: [AuthHookController],
});
