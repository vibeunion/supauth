import { Controller, defineModule, Injectable, Get, Patch, Post, Delete } from '@supacloud/app';
import { myAccountRoutes } from '../../routes/my-account.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';

@Injectable()
export class MyAccountPatchProfileAction {
  execute(context: Parameters<typeof myAccountRoutes.operations.patchProfile.execute>[0]) {
    requireAdminAction('account_center.manage');
    return myAccountRoutes.operations.patchProfile.execute(context);
  }
}

@Injectable()
export class MyAccountPostSessionsBySessionIdRevokeAction {
  execute(context: Parameters<typeof myAccountRoutes.operations.postSessionsBySessionIdRevoke.execute>[0]) {
    requireAdminAction('account_center.manage');
    return myAccountRoutes.operations.postSessionsBySessionIdRevoke.execute(context);
  }
}

@Injectable()
export class MyAccountDeleteIdentitiesByIdentityIdAction {
  execute(context: Parameters<typeof myAccountRoutes.operations.deleteIdentitiesByIdentityId.execute>[0]) {
    requireAdminAction('account_center.manage');
    return myAccountRoutes.operations.deleteIdentitiesByIdentityId.execute(context);
  }
}

@Injectable()
export class MyAccountDeleteGrantsByClientIdAction {
  execute(context: Parameters<typeof myAccountRoutes.operations.deleteGrantsByClientId.execute>[0]) {
    requireAdminAction('account_center.manage');
    return myAccountRoutes.operations.deleteGrantsByClientId.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/my-account")
export class MyAccountController {
  constructor(
    private readonly patchProfileAction: MyAccountPatchProfileAction,
    private readonly postSessionsBySessionIdRevokeAction: MyAccountPostSessionsBySessionIdRevokeAction,
    private readonly deleteIdentitiesByIdentityIdAction: MyAccountDeleteIdentitiesByIdentityIdAction,
    private readonly deleteGrantsByClientIdAction: MyAccountDeleteGrantsByClientIdAction,
  ) {}

  @Get("/profile", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/my-account.ts#getProfile" },
    aspects: [adminHttpAspect],
  })
  getProfile(ctx: HttpInvocation): Promise<Response> {
    return myAccountRoutes.operations.getProfile.invoke(ctx);
  }

  @Patch("/profile", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/my-account.ts#patchProfile" },
    aspects: [adminHttpAspect],
  })
  patchProfile(ctx: HttpInvocation): Promise<Response> {
    return myAccountRoutes.operations.patchProfile.invoke(ctx, context => this.patchProfileAction.execute(context));
  }

  @Get("/sessions", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/my-account.ts#getSessions" },
    aspects: [adminHttpAspect],
  })
  getSessions(ctx: HttpInvocation): Promise<Response> {
    return myAccountRoutes.operations.getSessions.invoke(ctx);
  }

  @Post("/sessions/:sessionId/revoke", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/my-account.ts#postSessionsBySessionIdRevoke" },
    aspects: [adminHttpAspect],
  })
  postSessionsBySessionIdRevoke(ctx: HttpInvocation): Promise<Response> {
    return myAccountRoutes.operations.postSessionsBySessionIdRevoke.invoke(ctx, context => this.postSessionsBySessionIdRevokeAction.execute(context));
  }

  @Delete("/identities/:identityId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/my-account.ts#deleteIdentitiesByIdentityId" },
    aspects: [adminHttpAspect],
  })
  deleteIdentitiesByIdentityId(ctx: HttpInvocation): Promise<Response> {
    return myAccountRoutes.operations.deleteIdentitiesByIdentityId.invoke(ctx, context => this.deleteIdentitiesByIdentityIdAction.execute(context));
  }

  @Get("/grants", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/my-account.ts#getGrants" },
    aspects: [adminHttpAspect],
  })
  getGrants(ctx: HttpInvocation): Promise<Response> {
    return myAccountRoutes.operations.getGrants.invoke(ctx);
  }

  @Delete("/grants/:clientId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/my-account.ts#deleteGrantsByClientId" },
    aspects: [adminHttpAspect],
  })
  deleteGrantsByClientId(ctx: HttpInvocation): Promise<Response> {
    return myAccountRoutes.operations.deleteGrantsByClientId.invoke(ctx, context => this.deleteGrantsByClientIdAction.execute(context));
  }

}

export const MyAccountModule = defineModule({
  name: 'supauth-my-account',
  tags: ['type:feature', 'scope:supauth-my-account'],
  providers: [MyAccountPatchProfileAction, MyAccountPostSessionsBySessionIdRevokeAction, MyAccountDeleteIdentitiesByIdentityIdAction, MyAccountDeleteGrantsByClientIdAction],
  controllers: [MyAccountController],
});
