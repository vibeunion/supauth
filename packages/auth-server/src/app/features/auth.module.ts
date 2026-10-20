import { Controller, defineModule, Injectable, Post, Get } from '@supacloud/app';
import { authRoutes } from '../../auth/index.js';
import type { HttpInvocation } from '../../http/operation.js';

@Injectable({ scope: 'application' })
@Controller("/v1/auth")
export class AuthController {
  @Post("/login", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/auth/index.ts#postLogin" },
  })
  postLogin(ctx: HttpInvocation): Promise<Response> {
    return authRoutes.operations.postLogin.invoke(ctx);
  }

  @Post("/logout", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/auth/index.ts#postLogout" },
  })
  postLogout(ctx: HttpInvocation): Promise<Response> {
    return authRoutes.operations.postLogout.invoke(ctx);
  }

  @Get("/identity", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/auth/index.ts#getIdentity" },
  })
  getIdentity(ctx: HttpInvocation): Promise<Response> {
    return authRoutes.operations.getIdentity.invoke(ctx);
  }

  @Get("/health", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/auth/index.ts#getHealth" },
  })
  getHealth(ctx: HttpInvocation): Promise<Response> {
    return authRoutes.operations.getHealth.invoke(ctx);
  }

}

export const AuthModule = defineModule({
  name: 'supauth-auth',
  tags: ['type:feature', 'scope:supauth-auth'],
  providers: [],
  controllers: [AuthController],
});
