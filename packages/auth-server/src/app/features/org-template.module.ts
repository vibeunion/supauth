import { Controller, defineModule, Injectable, Get, Post, Put, Delete } from '@supacloud/app';
import { orgTemplateRoutes } from '../../routes/org-templates.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

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
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/org-templates.ts#getRoot" },
    aspects: [adminHttpAspect],
  })
  getRoot(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => orgTemplateRoutes.operations.getRoot.invoke(ctx));
  }

  @Get("/default", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/org-templates.ts#getDefault" },
    aspects: [adminHttpAspect],
  })
  getDefault(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => orgTemplateRoutes.operations.getDefault.invoke(ctx));
  }

  @Get("/:templateId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/org-templates.ts#getByTemplateId" },
    aspects: [adminHttpAspect],
  })
  getByTemplateId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => orgTemplateRoutes.operations.getByTemplateId.invoke(ctx));
  }

  @Post("/", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/org-templates.ts#postRoot" },
    aspects: [adminHttpAspect],
  })
  postRoot(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => orgTemplateRoutes.operations.postRoot.invoke(ctx, context => this.postRootAction.execute(context)));
  }

  @Put("/:templateId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/org-templates.ts#putByTemplateId" },
    aspects: [adminHttpAspect],
  })
  putByTemplateId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => orgTemplateRoutes.operations.putByTemplateId.invoke(ctx, context => this.putByTemplateIdAction.execute(context)));
  }

  @Delete("/:templateId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/org-templates.ts#deleteByTemplateId" },
    aspects: [adminHttpAspect],
  })
  deleteByTemplateId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => orgTemplateRoutes.operations.deleteByTemplateId.invoke(ctx, context => this.deleteByTemplateIdAction.execute(context)));
  }

  @Post("/:templateId/instantiate", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/org-templates.ts#postByTemplateIdInstantiate" },
    aspects: [adminHttpAspect],
  })
  postByTemplateIdInstantiate(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => orgTemplateRoutes.operations.postByTemplateIdInstantiate.invoke(ctx, context => this.postByTemplateIdInstantiateAction.execute(context)));
  }

}

export const OrgTemplateModule = defineModule({
  name: 'supauth-org-template',
  tags: ['type:feature', 'scope:supauth-org-template'],
  providers: [OrgTemplatePostRootAction, OrgTemplatePutByTemplateIdAction, OrgTemplateDeleteByTemplateIdAction, OrgTemplatePostByTemplateIdInstantiateAction],
  controllers: [OrgTemplateController],
});
