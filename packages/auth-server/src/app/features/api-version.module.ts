import { Controller, defineModule, Injectable, Get, Post } from '@supacloud/app';
import { apiVersionRoutes } from '../../routes/api-versions.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';

@Injectable()
export class ApiVersionPostRootAction {
  execute(context: Parameters<typeof apiVersionRoutes.operations.postRoot.execute>[0]) {
    requireAdminAction('operations.manage');
    return apiVersionRoutes.operations.postRoot.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/api-versions")
export class ApiVersionController {
  constructor(
    private readonly postRootAction: ApiVersionPostRootAction,
  ) {}

  @Get("/", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/api-versions.ts#getRoot" },
    aspects: [adminHttpAspect],
  })
  getRoot(ctx: HttpInvocation): Promise<Response> {
    return apiVersionRoutes.operations.getRoot.invoke(ctx);
  }

  @Get("/:version", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/api-versions.ts#getByVersion" },
    aspects: [adminHttpAspect],
  })
  getByVersion(ctx: HttpInvocation): Promise<Response> {
    return apiVersionRoutes.operations.getByVersion.invoke(ctx);
  }

  @Post("/", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/api-versions.ts#postRoot" },
    aspects: [adminHttpAspect],
  })
  postRoot(ctx: HttpInvocation): Promise<Response> {
    return apiVersionRoutes.operations.postRoot.invoke(ctx, context => this.postRootAction.execute(context));
  }

}

export const ApiVersionModule = defineModule({
  name: 'supauth-api-version',
  tags: ['type:feature', 'scope:supauth-api-version'],
  providers: [ApiVersionPostRootAction],
  controllers: [ApiVersionController],
});
