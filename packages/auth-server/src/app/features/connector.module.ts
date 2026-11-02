import { Controller, defineModule, Injectable, Get, Put, Post, Patch } from '@supacloud/app';
import { connectorRoutes } from '../../routes/connectors.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable()
export class ConnectorPutFactoriesByFactoryIdAction {
  execute(context: Parameters<typeof connectorRoutes.operations.putFactoriesByFactoryId.execute>[0]) {
    requireAdminAction('connectors.manage');
    return connectorRoutes.operations.putFactoriesByFactoryId.execute(context);
  }
}

@Injectable()
export class ConnectorPostFromFactoryByFactoryIdAction {
  execute(context: Parameters<typeof connectorRoutes.operations.postFromFactoryByFactoryId.execute>[0]) {
    requireAdminAction('connectors.manage');
    return connectorRoutes.operations.postFromFactoryByFactoryId.execute(context);
  }
}

@Injectable()
export class ConnectorPatchByConnectorIdAction {
  execute(context: Parameters<typeof connectorRoutes.operations.patchByConnectorId.execute>[0]) {
    requireAdminAction('connectors.manage');
    return connectorRoutes.operations.patchByConnectorId.execute(context);
  }
}

@Injectable()
export class ConnectorPostByConnectorIdTestAction {
  execute(context: Parameters<typeof connectorRoutes.operations.postByConnectorIdTest.execute>[0]) {
    requireAdminAction('connectors.manage');
    return connectorRoutes.operations.postByConnectorIdTest.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/connectors")
export class ConnectorController {
  constructor(
    private readonly putFactoriesByFactoryIdAction: ConnectorPutFactoriesByFactoryIdAction,
    private readonly postFromFactoryByFactoryIdAction: ConnectorPostFromFactoryByFactoryIdAction,
    private readonly patchByConnectorIdAction: ConnectorPatchByConnectorIdAction,
    private readonly postByConnectorIdTestAction: ConnectorPostByConnectorIdTestAction,
  ) {}

  @Get("/", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/connectors.ts#getRoot" },
    aspects: [adminHttpAspect],
  })
  getRoot(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => connectorRoutes.operations.getRoot.invoke(ctx));
  }

  @Get("/factories", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/connectors.ts#getFactories" },
    aspects: [adminHttpAspect],
  })
  getFactories(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => connectorRoutes.operations.getFactories.invoke(ctx));
  }

  @Put("/factories/:factoryId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/connectors.ts#putFactoriesByFactoryId" },
    aspects: [adminHttpAspect],
  })
  putFactoriesByFactoryId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => connectorRoutes.operations.putFactoriesByFactoryId.invoke(ctx, context => this.putFactoriesByFactoryIdAction.execute(context)));
  }

  @Post("/from-factory/:factoryId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/connectors.ts#postFromFactoryByFactoryId" },
    aspects: [adminHttpAspect],
  })
  postFromFactoryByFactoryId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => connectorRoutes.operations.postFromFactoryByFactoryId.invoke(ctx, context => this.postFromFactoryByFactoryIdAction.execute(context)));
  }

  @Get("/:connectorId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/connectors.ts#getByConnectorId" },
    aspects: [adminHttpAspect],
  })
  getByConnectorId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => connectorRoutes.operations.getByConnectorId.invoke(ctx));
  }

  @Get("/:connectorId/authorization-uri", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/connectors.ts#getByConnectorIdAuthorizationUri" },
    aspects: [adminHttpAspect],
  })
  getByConnectorIdAuthorizationUri(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => connectorRoutes.operations.getByConnectorIdAuthorizationUri.invoke(ctx));
  }

  @Patch("/:connectorId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/connectors.ts#patchByConnectorId" },
    aspects: [adminHttpAspect],
  })
  patchByConnectorId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => connectorRoutes.operations.patchByConnectorId.invoke(ctx, context => this.patchByConnectorIdAction.execute(context)));
  }

  @Post("/:connectorId/test", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/connectors.ts#postByConnectorIdTest" },
    aspects: [adminHttpAspect],
  })
  postByConnectorIdTest(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => connectorRoutes.operations.postByConnectorIdTest.invoke(ctx, context => this.postByConnectorIdTestAction.execute(context)));
  }

}

export const ConnectorModule = defineModule({
  name: 'supauth-connector',
  tags: ['type:feature', 'scope:supauth-connector'],
  providers: [ConnectorPutFactoriesByFactoryIdAction, ConnectorPostFromFactoryByFactoryIdAction, ConnectorPatchByConnectorIdAction, ConnectorPostByConnectorIdTestAction],
  controllers: [ConnectorController],
});
