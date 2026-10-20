import { Controller, defineModule, Injectable, Get, Put, Delete } from '@supacloud/app';
import { passkeyRoutes } from '../../routes/passkeys.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';

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
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/passkeys.ts#getByUserId" },
    aspects: [adminHttpAspect],
  })
  getByUserId(ctx: HttpInvocation): Promise<Response> {
    return passkeyRoutes.operations.getByUserId.invoke(ctx);
  }

  @Put("/:passkeyId/rename", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/passkeys.ts#putByPasskeyIdRename" },
    aspects: [adminHttpAspect],
  })
  putByPasskeyIdRename(ctx: HttpInvocation): Promise<Response> {
    return passkeyRoutes.operations.putByPasskeyIdRename.invoke(ctx, context => this.putByPasskeyIdRenameAction.execute(context));
  }

  @Delete("/:passkeyId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/passkeys.ts#deleteByPasskeyId" },
    aspects: [adminHttpAspect],
  })
  deleteByPasskeyId(ctx: HttpInvocation): Promise<Response> {
    return passkeyRoutes.operations.deleteByPasskeyId.invoke(ctx, context => this.deleteByPasskeyIdAction.execute(context));
  }

}

export const PasskeyModule = defineModule({
  name: 'supauth-passkey',
  tags: ['type:feature', 'scope:supauth-passkey'],
  providers: [PasskeyPutByPasskeyIdRenameAction, PasskeyDeleteByPasskeyIdAction],
  controllers: [PasskeyController],
});
