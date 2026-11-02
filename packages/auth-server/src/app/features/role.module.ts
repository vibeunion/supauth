import { Controller, defineModule, Injectable, Get, Post, Put, Delete } from '@supacloud/app';
import { roleRoutes } from '../../routes/roles.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable()
export class RolePostRootAction {
  execute(context: Parameters<typeof roleRoutes.operations.postRoot.execute>[0]) {
    requireAdminAction('roles.manage');
    return roleRoutes.operations.postRoot.execute(context);
  }
}

@Injectable()
export class RolePutByRoleIdAction {
  execute(context: Parameters<typeof roleRoutes.operations.putByRoleId.execute>[0]) {
    requireAdminAction('roles.manage');
    return roleRoutes.operations.putByRoleId.execute(context);
  }
}

@Injectable()
export class RoleDeleteByRoleIdAction {
  execute(context: Parameters<typeof roleRoutes.operations.deleteByRoleId.execute>[0]) {
    requireAdminAction('roles.manage');
    return roleRoutes.operations.deleteByRoleId.execute(context);
  }
}

@Injectable()
export class RolePostByRoleIdPermissionsAction {
  execute(context: Parameters<typeof roleRoutes.operations.postByRoleIdPermissions.execute>[0]) {
    requireAdminAction('roles.manage');
    return roleRoutes.operations.postByRoleIdPermissions.execute(context);
  }
}

@Injectable()
export class RoleDeleteByRoleIdPermissionsByPermissionIdAction {
  execute(context: Parameters<typeof roleRoutes.operations.deleteByRoleIdPermissionsByPermissionId.execute>[0]) {
    requireAdminAction('roles.manage');
    return roleRoutes.operations.deleteByRoleIdPermissionsByPermissionId.execute(context);
  }
}

@Injectable()
export class RolePostByRoleIdAssignAction {
  execute(context: Parameters<typeof roleRoutes.operations.postByRoleIdAssign.execute>[0]) {
    requireAdminAction('roles.manage');
    return roleRoutes.operations.postByRoleIdAssign.execute(context);
  }
}

@Injectable()
export class RoleDeleteByRoleIdAssignByAssignmentIdAction {
  execute(context: Parameters<typeof roleRoutes.operations.deleteByRoleIdAssignByAssignmentId.execute>[0]) {
    requireAdminAction('roles.manage');
    return roleRoutes.operations.deleteByRoleIdAssignByAssignmentId.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/roles")
export class RoleController {
  constructor(
    private readonly postRootAction: RolePostRootAction,
    private readonly putByRoleIdAction: RolePutByRoleIdAction,
    private readonly deleteByRoleIdAction: RoleDeleteByRoleIdAction,
    private readonly postByRoleIdPermissionsAction: RolePostByRoleIdPermissionsAction,
    private readonly deleteByRoleIdPermissionsByPermissionIdAction: RoleDeleteByRoleIdPermissionsByPermissionIdAction,
    private readonly postByRoleIdAssignAction: RolePostByRoleIdAssignAction,
    private readonly deleteByRoleIdAssignByAssignmentIdAction: RoleDeleteByRoleIdAssignByAssignmentIdAction,
  ) {}

  @Get("/", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/roles.ts#getRoot" },
    aspects: [adminHttpAspect],
  })
  getRoot(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => roleRoutes.operations.getRoot.invoke(ctx));
  }

  @Post("/", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/roles.ts#postRoot" },
    aspects: [adminHttpAspect],
  })
  postRoot(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => roleRoutes.operations.postRoot.invoke(ctx, context => this.postRootAction.execute(context)));
  }

  @Get("/:roleId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/roles.ts#getByRoleId" },
    aspects: [adminHttpAspect],
  })
  getByRoleId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => roleRoutes.operations.getByRoleId.invoke(ctx));
  }

  @Put("/:roleId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/roles.ts#putByRoleId" },
    aspects: [adminHttpAspect],
  })
  putByRoleId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => roleRoutes.operations.putByRoleId.invoke(ctx, context => this.putByRoleIdAction.execute(context)));
  }

  @Delete("/:roleId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/roles.ts#deleteByRoleId" },
    aspects: [adminHttpAspect],
  })
  deleteByRoleId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => roleRoutes.operations.deleteByRoleId.invoke(ctx, context => this.deleteByRoleIdAction.execute(context)));
  }

  @Post("/:roleId/permissions", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/roles.ts#postByRoleIdPermissions" },
    aspects: [adminHttpAspect],
  })
  postByRoleIdPermissions(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => roleRoutes.operations.postByRoleIdPermissions.invoke(ctx, context => this.postByRoleIdPermissionsAction.execute(context)));
  }

  @Delete("/:roleId/permissions/:permissionId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/roles.ts#deleteByRoleIdPermissionsByPermissionId" },
    aspects: [adminHttpAspect],
  })
  deleteByRoleIdPermissionsByPermissionId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => roleRoutes.operations.deleteByRoleIdPermissionsByPermissionId.invoke(ctx, context => this.deleteByRoleIdPermissionsByPermissionIdAction.execute(context)));
  }

  @Get("/:roleId/permissions", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/roles.ts#getByRoleIdPermissions" },
    aspects: [adminHttpAspect],
  })
  getByRoleIdPermissions(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => roleRoutes.operations.getByRoleIdPermissions.invoke(ctx));
  }

  @Get("/:roleId/assign", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/roles.ts#getByRoleIdAssign" },
    aspects: [adminHttpAspect],
  })
  getByRoleIdAssign(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => roleRoutes.operations.getByRoleIdAssign.invoke(ctx));
  }

  @Post("/:roleId/assign", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/roles.ts#postByRoleIdAssign" },
    aspects: [adminHttpAspect],
  })
  postByRoleIdAssign(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => roleRoutes.operations.postByRoleIdAssign.invoke(ctx, context => this.postByRoleIdAssignAction.execute(context)));
  }

  @Delete("/:roleId/assign/:assignmentId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/roles.ts#deleteByRoleIdAssignByAssignmentId" },
    aspects: [adminHttpAspect],
  })
  deleteByRoleIdAssignByAssignmentId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => roleRoutes.operations.deleteByRoleIdAssignByAssignmentId.invoke(ctx, context => this.deleteByRoleIdAssignByAssignmentIdAction.execute(context)));
  }

}

export const RoleModule = defineModule({
  name: 'supauth-role',
  tags: ['type:feature', 'scope:supauth-role'],
  providers: [RolePostRootAction, RolePutByRoleIdAction, RoleDeleteByRoleIdAction, RolePostByRoleIdPermissionsAction, RoleDeleteByRoleIdPermissionsByPermissionIdAction, RolePostByRoleIdAssignAction, RoleDeleteByRoleIdAssignByAssignmentIdAction],
  controllers: [RoleController],
});
