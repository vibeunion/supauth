import { Controller, defineModule, Injectable, Get, Post, Put, Delete } from '@supacloud/app';
import { webhookRoutes } from '../../routes/webhooks.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable()
export class WebhookPostRootAction {
  execute(context: Parameters<typeof webhookRoutes.operations.postRoot.execute>[0]) {
    requireAdminAction('webhooks.manage');
    return webhookRoutes.operations.postRoot.execute(context);
  }
}

@Injectable()
export class WebhookPutByWebhookIdAction {
  execute(context: Parameters<typeof webhookRoutes.operations.putByWebhookId.execute>[0]) {
    requireAdminAction('webhooks.manage');
    return webhookRoutes.operations.putByWebhookId.execute(context);
  }
}

@Injectable()
export class WebhookDeleteByWebhookIdAction {
  execute(context: Parameters<typeof webhookRoutes.operations.deleteByWebhookId.execute>[0]) {
    requireAdminAction('webhooks.manage');
    return webhookRoutes.operations.deleteByWebhookId.execute(context);
  }
}

@Injectable()
export class WebhookPostByWebhookIdRotateSecretAction {
  execute(context: Parameters<typeof webhookRoutes.operations.postByWebhookIdRotateSecret.execute>[0]) {
    requireAdminAction('webhooks.manage');
    return webhookRoutes.operations.postByWebhookIdRotateSecret.execute(context);
  }
}

@Injectable()
export class WebhookPostByWebhookIdTestAction {
  execute(context: Parameters<typeof webhookRoutes.operations.postByWebhookIdTest.execute>[0]) {
    requireAdminAction('webhooks.manage');
    return webhookRoutes.operations.postByWebhookIdTest.execute(context);
  }
}

@Injectable()
export class WebhookPostByWebhookIdDeliveriesByDeliveryIdReplayAction {
  execute(context: Parameters<typeof webhookRoutes.operations.postByWebhookIdDeliveriesByDeliveryIdReplay.execute>[0]) {
    requireAdminAction('webhooks.replay');
    return webhookRoutes.operations.postByWebhookIdDeliveriesByDeliveryIdReplay.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/webhooks")
export class WebhookController {
  constructor(
    private readonly postRootAction: WebhookPostRootAction,
    private readonly putByWebhookIdAction: WebhookPutByWebhookIdAction,
    private readonly deleteByWebhookIdAction: WebhookDeleteByWebhookIdAction,
    private readonly postByWebhookIdRotateSecretAction: WebhookPostByWebhookIdRotateSecretAction,
    private readonly postByWebhookIdTestAction: WebhookPostByWebhookIdTestAction,
    private readonly postByWebhookIdDeliveriesByDeliveryIdReplayAction: WebhookPostByWebhookIdDeliveriesByDeliveryIdReplayAction,
  ) {}

  @Get("/", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/webhooks.ts#getRoot" },
    aspects: [adminHttpAspect],
  })
  getRoot(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => webhookRoutes.operations.getRoot.invoke(ctx));
  }

  @Post("/", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/webhooks.ts#postRoot" },
    aspects: [adminHttpAspect],
  })
  postRoot(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => webhookRoutes.operations.postRoot.invoke(ctx, context => this.postRootAction.execute(context)));
  }

  @Get("/events", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/webhooks.ts#getEvents" },
    aspects: [adminHttpAspect],
  })
  getEvents(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => webhookRoutes.operations.getEvents.invoke(ctx));
  }

  @Get("/:webhookId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/webhooks.ts#getByWebhookId" },
    aspects: [adminHttpAspect],
  })
  getByWebhookId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => webhookRoutes.operations.getByWebhookId.invoke(ctx));
  }

  @Get("/:webhookId/logs", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/webhooks.ts#getByWebhookIdLogs" },
    aspects: [adminHttpAspect],
  })
  getByWebhookIdLogs(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => webhookRoutes.operations.getByWebhookIdLogs.invoke(ctx));
  }

  @Put("/:webhookId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/webhooks.ts#putByWebhookId" },
    aspects: [adminHttpAspect],
  })
  putByWebhookId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => webhookRoutes.operations.putByWebhookId.invoke(ctx, context => this.putByWebhookIdAction.execute(context)));
  }

  @Delete("/:webhookId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/webhooks.ts#deleteByWebhookId" },
    aspects: [adminHttpAspect],
  })
  deleteByWebhookId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => webhookRoutes.operations.deleteByWebhookId.invoke(ctx, context => this.deleteByWebhookIdAction.execute(context)));
  }

  @Post("/:webhookId/rotate-secret", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/webhooks.ts#postByWebhookIdRotateSecret" },
    aspects: [adminHttpAspect],
  })
  postByWebhookIdRotateSecret(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => webhookRoutes.operations.postByWebhookIdRotateSecret.invoke(ctx, context => this.postByWebhookIdRotateSecretAction.execute(context)));
  }

  @Post("/:webhookId/test", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/webhooks.ts#postByWebhookIdTest" },
    aspects: [adminHttpAspect],
  })
  postByWebhookIdTest(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => webhookRoutes.operations.postByWebhookIdTest.invoke(ctx, context => this.postByWebhookIdTestAction.execute(context)));
  }

  @Get("/:webhookId/deliveries", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/webhooks.ts#getByWebhookIdDeliveries" },
    aspects: [adminHttpAspect],
  })
  getByWebhookIdDeliveries(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => webhookRoutes.operations.getByWebhookIdDeliveries.invoke(ctx));
  }

  @Get("/:webhookId/deliveries/:deliveryId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/webhooks.ts#getByWebhookIdDeliveriesByDeliveryId" },
    aspects: [adminHttpAspect],
  })
  getByWebhookIdDeliveriesByDeliveryId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => webhookRoutes.operations.getByWebhookIdDeliveriesByDeliveryId.invoke(ctx));
  }

  @Post("/:webhookId/deliveries/:deliveryId/replay", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/webhooks.ts#postByWebhookIdDeliveriesByDeliveryIdReplay" },
    aspects: [adminHttpAspect],
  })
  postByWebhookIdDeliveriesByDeliveryIdReplay(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => webhookRoutes.operations.postByWebhookIdDeliveriesByDeliveryIdReplay.invoke(ctx, context => this.postByWebhookIdDeliveriesByDeliveryIdReplayAction.execute(context)));
  }

}

export const WebhookModule = defineModule({
  name: 'supauth-webhook',
  tags: ['type:feature', 'scope:supauth-webhook'],
  providers: [WebhookPostRootAction, WebhookPutByWebhookIdAction, WebhookDeleteByWebhookIdAction, WebhookPostByWebhookIdRotateSecretAction, WebhookPostByWebhookIdTestAction, WebhookPostByWebhookIdDeliveriesByDeliveryIdReplayAction],
  controllers: [WebhookController],
});
