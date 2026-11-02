import { Controller, defineModule, Injectable, Get, Put, Delete } from '@supacloud/app';
import { passkeyRoutes } from '../../routes/passkeys.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable()
export class PasskeyPutByPasskeyIdRenameAction {
  execute(context: Parameters<typeof passkeyRoutes.operations.putByPasskeyIdRename.execute>[0]) {
    requireAdminAction('account_center.manage');
    return passkeyRoutes.operations.putByPasskeyIdRename.execute(context);
  }
}

@Injectable()
export class PasskeyDeleteByPasskeyIdAction {
  execute(context: Parameters<typeof passkeyRoutes.operations.deleteByPasskeyId.execute>[0]) {
    requireAdminAction('account_center.manage');
    return passkeyRoutes.operations.deleteByPasskeyId.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/passkeys")
export class PasskeyController {
  constructor(
    private readonly putByPasskeyIdRenameAction: PasskeyPutByPasskeyIdRenameAction,
    private readonly deleteByPasskeyIdAction: PasskeyDeleteByPasskeyIdAction,
  ) {}

  @Get("/:userId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/passkeys.ts#getByUserId" },
    aspects: [adminHttpAspect],
  })
  getByUserId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => passkeyRoutes.operations.getByUserId.invoke(ctx));
  }

  @Put("/:passkeyId/rename", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/passkeys.ts#putByPasskeyIdRename" },
    aspects: [adminHttpAspect],
  })
  putByPasskeyIdRename(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => passkeyRoutes.operations.putByPasskeyIdRename.invoke(ctx, context => this.putByPasskeyIdRenameAction.execute(context)));
  }

  @Delete("/:passkeyId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/passkeys.ts#deleteByPasskeyId" },
    aspects: [adminHttpAspect],
  })
  deleteByPasskeyId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => passkeyRoutes.operations.deleteByPasskeyId.invoke(ctx, context => this.deleteByPasskeyIdAction.execute(context)));
  }

}

export const PasskeyModule = defineModule({
  name: 'supauth-passkey',
  tags: ['type:feature', 'scope:supauth-passkey'],
  providers: [PasskeyPutByPasskeyIdRenameAction, PasskeyDeleteByPasskeyIdAction],
  controllers: [PasskeyController],
});
