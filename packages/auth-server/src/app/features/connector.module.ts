import { Controller, defineModule, Injectable, Get, Put, Post, Patch } from '@supacloud/app';
import { connectorRoutes } from '../../routes/connectors.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';

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
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/connectors.ts#getRoot" },
    aspects: [adminHttpAspect],
  })
  getRoot(ctx: HttpInvocation): Promise<Response> {
    return connectorRoutes.operations.getRoot.invoke(ctx);
  }

  @Get("/factories", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/connectors.ts#getFactories" },
    aspects: [adminHttpAspect],
  })
  getFactories(ctx: HttpInvocation): Promise<Response> {
    return connectorRoutes.operations.getFactories.invoke(ctx);
  }

  @Put("/factories/:factoryId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/connectors.ts#putFactoriesByFactoryId" },
    aspects: [adminHttpAspect],
  })
  putFactoriesByFactoryId(ctx: HttpInvocation): Promise<Response> {
    return connectorRoutes.operations.putFactoriesByFactoryId.invoke(ctx, context => this.putFactoriesByFactoryIdAction.execute(context));
  }

  @Post("/from-factory/:factoryId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/connectors.ts#postFromFactoryByFactoryId" },
    aspects: [adminHttpAspect],
  })
  postFromFactoryByFactoryId(ctx: HttpInvocation): Promise<Response> {
    return connectorRoutes.operations.postFromFactoryByFactoryId.invoke(ctx, context => this.postFromFactoryByFactoryIdAction.execute(context));
  }

  @Get("/:connectorId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/connectors.ts#getByConnectorId" },
    aspects: [adminHttpAspect],
  })
  getByConnectorId(ctx: HttpInvocation): Promise<Response> {
    return connectorRoutes.operations.getByConnectorId.invoke(ctx);
  }

  @Get("/:connectorId/authorization-uri", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/connectors.ts#getByConnectorIdAuthorizationUri" },
    aspects: [adminHttpAspect],
  })
  getByConnectorIdAuthorizationUri(ctx: HttpInvocation): Promise<Response> {
    return connectorRoutes.operations.getByConnectorIdAuthorizationUri.invoke(ctx);
  }

  @Patch("/:connectorId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/connectors.ts#patchByConnectorId" },
    aspects: [adminHttpAspect],
  })
  patchByConnectorId(ctx: HttpInvocation): Promise<Response> {
    return connectorRoutes.operations.patchByConnectorId.invoke(ctx, context => this.patchByConnectorIdAction.execute(context));
  }

  @Post("/:connectorId/test", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/connectors.ts#postByConnectorIdTest" },
    aspects: [adminHttpAspect],
  })
  postByConnectorIdTest(ctx: HttpInvocation): Promise<Response> {
    return connectorRoutes.operations.postByConnectorIdTest.invoke(ctx, context => this.postByConnectorIdTestAction.execute(context));
  }

}

export const ConnectorModule = defineModule({
  name: 'supauth-connector',
  tags: ['type:feature', 'scope:supauth-connector'],
  providers: [ConnectorPutFactoriesByFactoryIdAction, ConnectorPostFromFactoryByFactoryIdAction, ConnectorPatchByConnectorIdAction, ConnectorPostByConnectorIdTestAction],
  controllers: [ConnectorController],
});
