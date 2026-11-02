import { Controller, defineModule, Injectable, Get, Post, Put, Delete } from '@supacloud/app';
import { enterpriseSSORoutes } from '../../routes/enterprise-sso.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable()
export class EnterpriseSSOPostRootAction {
  execute(context: Parameters<typeof enterpriseSSORoutes.operations.postRoot.execute>[0]) {
    requireAdminAction('connectors.manage');
    return enterpriseSSORoutes.operations.postRoot.execute(context);
  }
}

@Injectable()
export class EnterpriseSSOPutByIdAction {
  execute(context: Parameters<typeof enterpriseSSORoutes.operations.putById.execute>[0]) {
    requireAdminAction('connectors.manage');
    return enterpriseSSORoutes.operations.putById.execute(context);
  }
}

@Injectable()
export class EnterpriseSSODeleteByIdAction {
  execute(context: Parameters<typeof enterpriseSSORoutes.operations.deleteById.execute>[0]) {
    requireAdminAction('connectors.manage');
    return enterpriseSSORoutes.operations.deleteById.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/enterprise-sso")
export class EnterpriseSSOController {
  constructor(
    private readonly postRootAction: EnterpriseSSOPostRootAction,
    private readonly putByIdAction: EnterpriseSSOPutByIdAction,
    private readonly deleteByIdAction: EnterpriseSSODeleteByIdAction,
  ) {}

  @Get("/", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/enterprise-sso.ts#getRoot" },
    aspects: [adminHttpAspect],
  })
  getRoot(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => enterpriseSSORoutes.operations.getRoot.invoke(ctx));
  }

  @Get("/domain/:domain", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/enterprise-sso.ts#getDomainByDomain" },
    aspects: [adminHttpAspect],
  })
  getDomainByDomain(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => enterpriseSSORoutes.operations.getDomainByDomain.invoke(ctx));
  }

  @Get("/:id", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/enterprise-sso.ts#getById" },
    aspects: [adminHttpAspect],
  })
  getById(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => enterpriseSSORoutes.operations.getById.invoke(ctx));
  }

  @Post("/", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/enterprise-sso.ts#postRoot" },
    aspects: [adminHttpAspect],
  })
  postRoot(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => enterpriseSSORoutes.operations.postRoot.invoke(ctx, context => this.postRootAction.execute(context)));
  }

  @Put("/:id", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/enterprise-sso.ts#putById" },
    aspects: [adminHttpAspect],
  })
  putById(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => enterpriseSSORoutes.operations.putById.invoke(ctx, context => this.putByIdAction.execute(context)));
  }

  @Delete("/:id", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/enterprise-sso.ts#deleteById" },
    aspects: [adminHttpAspect],
  })
  deleteById(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => enterpriseSSORoutes.operations.deleteById.invoke(ctx, context => this.deleteByIdAction.execute(context)));
  }

}

export const EnterpriseSSOModule = defineModule({
  name: 'supauth-enterprise-sso',
  tags: ['type:feature', 'scope:supauth-enterprise-sso'],
  providers: [EnterpriseSSOPostRootAction, EnterpriseSSOPutByIdAction, EnterpriseSSODeleteByIdAction],
  controllers: [EnterpriseSSOController],
});
