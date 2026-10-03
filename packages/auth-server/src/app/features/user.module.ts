import { Controller, defineModule, Injectable, Get, Post, Put, Delete } from '@supacloud/app';
import { userRoutes } from '../../routes/users.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';

@Injectable()
export class UserPostRootAction {
  execute(context: Parameters<typeof userRoutes.operations.postRoot.execute>[0]) {
    requireAdminAction('users.manage');
    return userRoutes.operations.postRoot.execute(context);
  }
}

@Injectable()
export class UserPutByUserIdAction {
  execute(context: Parameters<typeof userRoutes.operations.putByUserId.execute>[0]) {
    requireAdminAction('users.manage');
    return userRoutes.operations.putByUserId.execute(context);
  }
}

@Injectable()
export class UserPostByUserIdSuspendAction {
  execute(context: Parameters<typeof userRoutes.operations.postByUserIdSuspend.execute>[0]) {
    requireAdminAction('users.manage');
    return userRoutes.operations.postByUserIdSuspend.execute(context);
  }
}

@Injectable()
export class UserPostByUserIdUnsuspendAction {
  execute(context: Parameters<typeof userRoutes.operations.postByUserIdUnsuspend.execute>[0]) {
    requireAdminAction('users.manage');
    return userRoutes.operations.postByUserIdUnsuspend.execute(context);
  }
}

@Injectable()
export class UserDeleteByUserIdAction {
  execute(context: Parameters<typeof userRoutes.operations.deleteByUserId.execute>[0]) {
    requireAdminAction('users.manage');
    return userRoutes.operations.deleteByUserId.execute(context);
  }
}

@Injectable()
export class UserPostByUserIdSessionsAction {
  execute(context: Parameters<typeof userRoutes.operations.postByUserIdSessions.execute>[0]) {
    requireAdminAction('users.manage');
    return userRoutes.operations.postByUserIdSessions.execute(context);
  }
}

@Injectable()
export class UserPostByUserIdSessionsBySessionIdRevokeAction {
  execute(context: Parameters<typeof userRoutes.operations.postByUserIdSessionsBySessionIdRevoke.execute>[0]) {
    requireAdminAction('users.manage');
    return userRoutes.operations.postByUserIdSessionsBySessionIdRevoke.execute(context);
  }
}

@Injectable()
export class UserDeleteByUserIdIdentitiesByIdentityIdAction {
  execute(context: Parameters<typeof userRoutes.operations.deleteByUserIdIdentitiesByIdentityId.execute>[0]) {
    requireAdminAction('users.manage');
    return userRoutes.operations.deleteByUserIdIdentitiesByIdentityId.execute(context);
  }
}

@Injectable()
export class UserPostByUserIdMfaByFactorIdResetAction {
  execute(context: Parameters<typeof userRoutes.operations.postByUserIdMfaByFactorIdReset.execute>[0]) {
    requireAdminAction('users.manage');
    return userRoutes.operations.postByUserIdMfaByFactorIdReset.execute(context);
  }
}

@Injectable()
export class UserDeleteByUserIdGrantsByClientIdAction {
  execute(context: Parameters<typeof userRoutes.operations.deleteByUserIdGrantsByClientId.execute>[0]) {
    requireAdminAction('users.manage');
    return userRoutes.operations.deleteByUserIdGrantsByClientId.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/users")
export class UserController {
  constructor(
    private readonly postRootAction: UserPostRootAction,
    private readonly putByUserIdAction: UserPutByUserIdAction,
    private readonly postByUserIdSuspendAction: UserPostByUserIdSuspendAction,
    private readonly postByUserIdUnsuspendAction: UserPostByUserIdUnsuspendAction,
    private readonly deleteByUserIdAction: UserDeleteByUserIdAction,
    private readonly postByUserIdSessionsAction: UserPostByUserIdSessionsAction,
    private readonly postByUserIdSessionsBySessionIdRevokeAction: UserPostByUserIdSessionsBySessionIdRevokeAction,
    private readonly deleteByUserIdIdentitiesByIdentityIdAction: UserDeleteByUserIdIdentitiesByIdentityIdAction,
    private readonly postByUserIdMfaByFactorIdResetAction: UserPostByUserIdMfaByFactorIdResetAction,
    private readonly deleteByUserIdGrantsByClientIdAction: UserDeleteByUserIdGrantsByClientIdAction,
  ) {}

  @Get("/", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/users.ts#getRoot" },
    aspects: [adminHttpAspect],
  })
  getRoot(ctx: HttpInvocation): Promise<Response> {
    return userRoutes.operations.getRoot.invoke(ctx);
  }

  @Post("/", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/users.ts#postRoot" },
    aspects: [adminHttpAspect],
  })
  postRoot(ctx: HttpInvocation): Promise<Response> {
    return userRoutes.operations.postRoot.invoke(ctx, context => this.postRootAction.execute(context));
  }

  @Get("/:userId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/users.ts#getByUserId" },
    aspects: [adminHttpAspect],
  })
  getByUserId(ctx: HttpInvocation): Promise<Response> {
    return userRoutes.operations.getByUserId.invoke(ctx);
  }

  @Put("/:userId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/users.ts#putByUserId" },
    aspects: [adminHttpAspect],
  })
  putByUserId(ctx: HttpInvocation): Promise<Response> {
    return userRoutes.operations.putByUserId.invoke(ctx, context => this.putByUserIdAction.execute(context));
  }

  @Post("/:userId/suspend", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/users.ts#postByUserIdSuspend" },
    aspects: [adminHttpAspect],
  })
  postByUserIdSuspend(ctx: HttpInvocation): Promise<Response> {
    return userRoutes.operations.postByUserIdSuspend.invoke(ctx, context => this.postByUserIdSuspendAction.execute(context));
  }

  @Post("/:userId/unsuspend", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/users.ts#postByUserIdUnsuspend" },
    aspects: [adminHttpAspect],
  })
  postByUserIdUnsuspend(ctx: HttpInvocation): Promise<Response> {
    return userRoutes.operations.postByUserIdUnsuspend.invoke(ctx, context => this.postByUserIdUnsuspendAction.execute(context));
  }

  @Delete("/:userId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/users.ts#deleteByUserId" },
    aspects: [adminHttpAspect],
  })
  deleteByUserId(ctx: HttpInvocation): Promise<Response> {
    return userRoutes.operations.deleteByUserId.invoke(ctx, context => this.deleteByUserIdAction.execute(context));
  }

  @Get("/:userId/sessions", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/users.ts#getByUserIdSessions" },
    aspects: [adminHttpAspect],
  })
  getByUserIdSessions(ctx: HttpInvocation): Promise<Response> {
    return userRoutes.operations.getByUserIdSessions.invoke(ctx);
  }

  @Post("/:userId/sessions", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/users.ts#postByUserIdSessions" },
    aspects: [adminHttpAspect],
  })
  postByUserIdSessions(ctx: HttpInvocation): Promise<Response> {
    return userRoutes.operations.postByUserIdSessions.invoke(ctx, context => this.postByUserIdSessionsAction.execute(context));
  }

  @Post("/:userId/sessions/:sessionId/revoke", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/users.ts#postByUserIdSessionsBySessionIdRevoke" },
    aspects: [adminHttpAspect],
  })
  postByUserIdSessionsBySessionIdRevoke(ctx: HttpInvocation): Promise<Response> {
    return userRoutes.operations.postByUserIdSessionsBySessionIdRevoke.invoke(ctx, context => this.postByUserIdSessionsBySessionIdRevokeAction.execute(context));
  }

  @Delete("/:userId/identities/:identityId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/users.ts#deleteByUserIdIdentitiesByIdentityId" },
    aspects: [adminHttpAspect],
  })
  deleteByUserIdIdentitiesByIdentityId(ctx: HttpInvocation): Promise<Response> {
    return userRoutes.operations.deleteByUserIdIdentitiesByIdentityId.invoke(ctx, context => this.deleteByUserIdIdentitiesByIdentityIdAction.execute(context));
  }

  @Post("/:userId/mfa/:factorId/reset", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/users.ts#postByUserIdMfaByFactorIdReset" },
    aspects: [adminHttpAspect],
  })
  postByUserIdMfaByFactorIdReset(ctx: HttpInvocation): Promise<Response> {
    return userRoutes.operations.postByUserIdMfaByFactorIdReset.invoke(ctx, context => this.postByUserIdMfaByFactorIdResetAction.execute(context));
  }

  @Get("/:userId/permissions", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/users.ts#getByUserIdPermissions" },
    aspects: [adminHttpAspect],
  })
  getByUserIdPermissions(ctx: HttpInvocation): Promise<Response> {
    return userRoutes.operations.getByUserIdPermissions.invoke(ctx);
  }

  @Get("/:userId/roles", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/users.ts#getByUserIdRoles" },
    aspects: [adminHttpAspect],
  })
  getByUserIdRoles(ctx: HttpInvocation): Promise<Response> {
    return userRoutes.operations.getByUserIdRoles.invoke(ctx);
  }

  @Get("/:userId/logs", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/users.ts#getByUserIdLogs" },
    aspects: [adminHttpAspect],
  })
  getByUserIdLogs(ctx: HttpInvocation): Promise<Response> {
    return userRoutes.operations.getByUserIdLogs.invoke(ctx);
  }

  @Get("/:userId/organizations", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/users.ts#getByUserIdOrganizations" },
    aspects: [adminHttpAspect],
  })
  getByUserIdOrganizations(ctx: HttpInvocation): Promise<Response> {
    return userRoutes.operations.getByUserIdOrganizations.invoke(ctx);
  }

  @Get("/:userId/grants", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/users.ts#getByUserIdGrants" },
    aspects: [adminHttpAspect],
  })
  getByUserIdGrants(ctx: HttpInvocation): Promise<Response> {
    return userRoutes.operations.getByUserIdGrants.invoke(ctx);
  }

  @Delete("/:userId/grants/:clientId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/users.ts#deleteByUserIdGrantsByClientId" },
    aspects: [adminHttpAspect],
  })
  deleteByUserIdGrantsByClientId(ctx: HttpInvocation): Promise<Response> {
    return userRoutes.operations.deleteByUserIdGrantsByClientId.invoke(ctx, context => this.deleteByUserIdGrantsByClientIdAction.execute(context));
  }

}

export const UserModule = defineModule({
  name: 'supauth-user',
  tags: ['type:feature', 'scope:supauth-user'],
  providers: [UserPostRootAction, UserPutByUserIdAction, UserPostByUserIdSuspendAction, UserPostByUserIdUnsuspendAction, UserDeleteByUserIdAction, UserPostByUserIdSessionsAction, UserPostByUserIdSessionsBySessionIdRevokeAction, UserDeleteByUserIdIdentitiesByIdentityIdAction, UserPostByUserIdMfaByFactorIdResetAction, UserDeleteByUserIdGrantsByClientIdAction],
  controllers: [UserController],
});
