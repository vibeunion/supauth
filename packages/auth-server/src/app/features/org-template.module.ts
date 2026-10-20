import { Controller, defineModule, Injectable, Get, Post, Put, Delete } from '@supacloud/app';
import { orgTemplateRoutes } from '../../routes/org-templates.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';

@Injectable()
export class OrgTemplatePostRootAction {
  execute(context: Parameters<typeof orgTemplateRoutes.operations.postRoot.execute>[0]) {
    requireAdminAction('organizations.manage');
    return orgTemplateRoutes.operations.postRoot.execute(context);
  }
}

@Injectable()
export class OrgTemplatePutByTemplateIdAction {
  execute(context: Parameters<typeof orgTemplateRoutes.operations.putByTemplateId.execute>[0]) {
    requireAdminAction('organizations.manage');
    return orgTemplateRoutes.operations.putByTemplateId.execute(context);
  }
}

@Injectable()
export class OrgTemplateDeleteByTemplateIdAction {
  execute(context: Parameters<typeof orgTemplateRoutes.operations.deleteByTemplateId.execute>[0]) {
    requireAdminAction('organizations.manage');
    return orgTemplateRoutes.operations.deleteByTemplateId.execute(context);
  }
}

@Injectable()
export class OrgTemplatePostByTemplateIdInstantiateAction {
  execute(context: Parameters<typeof orgTemplateRoutes.operations.postByTemplateIdInstantiate.execute>[0]) {
    requireAdminAction('organizations.manage');
    return orgTemplateRoutes.operations.postByTemplateIdInstantiate.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/org-templates")
export class OrgTemplateController {
  constructor(
    private readonly postRootAction: OrgTemplatePostRootAction,
    private readonly putByTemplateIdAction: OrgTemplatePutByTemplateIdAction,
    private readonly deleteByTemplateIdAction: OrgTemplateDeleteByTemplateIdAction,
    private readonly postByTemplateIdInstantiateAction: OrgTemplatePostByTemplateIdInstantiateAction,
  ) {}

  @Get("/", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/org-templates.ts#getRoot" },
    aspects: [adminHttpAspect],
  })
  getRoot(ctx: HttpInvocation): Promise<Response> {
    return orgTemplateRoutes.operations.getRoot.invoke(ctx);
  }

  @Get("/default", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/org-templates.ts#getDefault" },
    aspects: [adminHttpAspect],
  })
  getDefault(ctx: HttpInvocation): Promise<Response> {
    return orgTemplateRoutes.operations.getDefault.invoke(ctx);
  }

  @Get("/:templateId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/org-templates.ts#getByTemplateId" },
    aspects: [adminHttpAspect],
  })
  getByTemplateId(ctx: HttpInvocation): Promise<Response> {
    return orgTemplateRoutes.operations.getByTemplateId.invoke(ctx);
  }

  @Post("/", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/org-templates.ts#postRoot" },
    aspects: [adminHttpAspect],
  })
  postRoot(ctx: HttpInvocation): Promise<Response> {
    return orgTemplateRoutes.operations.postRoot.invoke(ctx, context => this.postRootAction.execute(context));
  }

  @Put("/:templateId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/org-templates.ts#putByTemplateId" },
    aspects: [adminHttpAspect],
  })
  putByTemplateId(ctx: HttpInvocation): Promise<Response> {
    return orgTemplateRoutes.operations.putByTemplateId.invoke(ctx, context => this.putByTemplateIdAction.execute(context));
  }

  @Delete("/:templateId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/org-templates.ts#deleteByTemplateId" },
    aspects: [adminHttpAspect],
  })
  deleteByTemplateId(ctx: HttpInvocation): Promise<Response> {
    return orgTemplateRoutes.operations.deleteByTemplateId.invoke(ctx, context => this.deleteByTemplateIdAction.execute(context));
  }

  @Post("/:templateId/instantiate", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/org-templates.ts#postByTemplateIdInstantiate" },
    aspects: [adminHttpAspect],
  })
  postByTemplateIdInstantiate(ctx: HttpInvocation): Promise<Response> {
    return orgTemplateRoutes.operations.postByTemplateIdInstantiate.invoke(ctx, context => this.postByTemplateIdInstantiateAction.execute(context));
  }

}

export const OrgTemplateModule = defineModule({
  name: 'supauth-org-template',
  tags: ['type:feature', 'scope:supauth-org-template'],
  providers: [OrgTemplatePostRootAction, OrgTemplatePutByTemplateIdAction, OrgTemplateDeleteByTemplateIdAction, OrgTemplatePostByTemplateIdInstantiateAction],
  controllers: [OrgTemplateController],
});
