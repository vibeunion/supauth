import { Controller, defineModule, Injectable, Get, Post, Put, Delete } from '@supacloud/app';
import { roleRoutes } from '../../routes/roles.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';

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
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/roles.ts#getRoot" },
    aspects: [adminHttpAspect],
  })
  getRoot(ctx: HttpInvocation): Promise<Response> {
    return roleRoutes.operations.getRoot.invoke(ctx);
  }

  @Post("/", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/roles.ts#postRoot" },
    aspects: [adminHttpAspect],
  })
  postRoot(ctx: HttpInvocation): Promise<Response> {
    return roleRoutes.operations.postRoot.invoke(ctx, context => this.postRootAction.execute(context));
  }

  @Get("/:roleId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/roles.ts#getByRoleId" },
    aspects: [adminHttpAspect],
  })
  getByRoleId(ctx: HttpInvocation): Promise<Response> {
    return roleRoutes.operations.getByRoleId.invoke(ctx);
  }

  @Put("/:roleId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/roles.ts#putByRoleId" },
    aspects: [adminHttpAspect],
  })
  putByRoleId(ctx: HttpInvocation): Promise<Response> {
    return roleRoutes.operations.putByRoleId.invoke(ctx, context => this.putByRoleIdAction.execute(context));
  }

  @Delete("/:roleId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/roles.ts#deleteByRoleId" },
    aspects: [adminHttpAspect],
  })
  deleteByRoleId(ctx: HttpInvocation): Promise<Response> {
    return roleRoutes.operations.deleteByRoleId.invoke(ctx, context => this.deleteByRoleIdAction.execute(context));
  }

  @Post("/:roleId/permissions", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/roles.ts#postByRoleIdPermissions" },
    aspects: [adminHttpAspect],
  })
  postByRoleIdPermissions(ctx: HttpInvocation): Promise<Response> {
    return roleRoutes.operations.postByRoleIdPermissions.invoke(ctx, context => this.postByRoleIdPermissionsAction.execute(context));
  }

  @Delete("/:roleId/permissions/:permissionId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/roles.ts#deleteByRoleIdPermissionsByPermissionId" },
    aspects: [adminHttpAspect],
  })
  deleteByRoleIdPermissionsByPermissionId(ctx: HttpInvocation): Promise<Response> {
    return roleRoutes.operations.deleteByRoleIdPermissionsByPermissionId.invoke(ctx, context => this.deleteByRoleIdPermissionsByPermissionIdAction.execute(context));
  }

  @Get("/:roleId/permissions", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/roles.ts#getByRoleIdPermissions" },
    aspects: [adminHttpAspect],
  })
  getByRoleIdPermissions(ctx: HttpInvocation): Promise<Response> {
    return roleRoutes.operations.getByRoleIdPermissions.invoke(ctx);
  }

  @Get("/:roleId/assign", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/roles.ts#getByRoleIdAssign" },
    aspects: [adminHttpAspect],
  })
  getByRoleIdAssign(ctx: HttpInvocation): Promise<Response> {
    return roleRoutes.operations.getByRoleIdAssign.invoke(ctx);
  }

  @Post("/:roleId/assign", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/roles.ts#postByRoleIdAssign" },
    aspects: [adminHttpAspect],
  })
  postByRoleIdAssign(ctx: HttpInvocation): Promise<Response> {
    return roleRoutes.operations.postByRoleIdAssign.invoke(ctx, context => this.postByRoleIdAssignAction.execute(context));
  }

  @Delete("/:roleId/assign/:assignmentId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/roles.ts#deleteByRoleIdAssignByAssignmentId" },
    aspects: [adminHttpAspect],
  })
  deleteByRoleIdAssignByAssignmentId(ctx: HttpInvocation): Promise<Response> {
    return roleRoutes.operations.deleteByRoleIdAssignByAssignmentId.invoke(ctx, context => this.deleteByRoleIdAssignByAssignmentIdAction.execute(context));
  }

}

export const RoleModule = defineModule({
  name: 'supauth-role',
  tags: ['type:feature', 'scope:supauth-role'],
  providers: [RolePostRootAction, RolePutByRoleIdAction, RoleDeleteByRoleIdAction, RolePostByRoleIdPermissionsAction, RoleDeleteByRoleIdPermissionsByPermissionIdAction, RolePostByRoleIdAssignAction, RoleDeleteByRoleIdAssignByAssignmentIdAction],
  controllers: [RoleController],
});
