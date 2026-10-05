import { Controller, defineModule, Injectable, Get, Post, Put, Delete, Patch } from '@supacloud/app';
import { organizationRoutes } from '../../routes/organizations.js';
import type { HttpInvocation } from '../../http/operation.js';
import { PublicOrganizationController } from './public-organization.module.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';

@Injectable()
export class OrganizationPostRootAction {
  execute(context: Parameters<typeof organizationRoutes.operations.postRoot.execute>[0]) {
    requireAdminAction('organizations.manage');
    return organizationRoutes.operations.postRoot.execute(context);
  }
}

@Injectable()
export class OrganizationPutByOrgIdAction {
  execute(context: Parameters<typeof organizationRoutes.operations.putByOrgId.execute>[0]) {
    requireAdminAction('organizations.manage');
    return organizationRoutes.operations.putByOrgId.execute(context);
  }
}

@Injectable()
export class OrganizationDeleteByOrgIdAction {
  execute(context: Parameters<typeof organizationRoutes.operations.deleteByOrgId.execute>[0]) {
    requireAdminAction('organizations.manage');
    return organizationRoutes.operations.deleteByOrgId.execute(context);
  }
}

@Injectable()
export class OrganizationPostByOrgIdMembersAction {
  execute(context: Parameters<typeof organizationRoutes.operations.postByOrgIdMembers.execute>[0]) {
    requireAdminAction('organizations.members.manage');
    return organizationRoutes.operations.postByOrgIdMembers.execute(context);
  }
}

@Injectable()
export class OrganizationDeleteByOrgIdMembersByUserIdAction {
  execute(context: Parameters<typeof organizationRoutes.operations.deleteByOrgIdMembersByUserId.execute>[0]) {
    requireAdminAction('organizations.members.manage');
    return organizationRoutes.operations.deleteByOrgIdMembersByUserId.execute(context);
  }
}

@Injectable()
export class OrganizationPatchByOrgIdMembersByUserIdAction {
  execute(context: Parameters<typeof organizationRoutes.operations.patchByOrgIdMembersByUserId.execute>[0]) {
    requireAdminAction('organizations.members.manage');
    return organizationRoutes.operations.patchByOrgIdMembersByUserId.execute(context);
  }
}

@Injectable()
export class OrganizationPostByOrgIdInvitationsAction {
  execute(context: Parameters<typeof organizationRoutes.operations.postByOrgIdInvitations.execute>[0]) {
    requireAdminAction('organizations.members.manage');
    return organizationRoutes.operations.postByOrgIdInvitations.execute(context);
  }
}

@Injectable()
export class OrganizationDeleteByOrgIdInvitationsByInvitationIdAction {
  execute(context: Parameters<typeof organizationRoutes.operations.deleteByOrgIdInvitationsByInvitationId.execute>[0]) {
    requireAdminAction('organizations.members.manage');
    return organizationRoutes.operations.deleteByOrgIdInvitationsByInvitationId.execute(context);
  }
}

@Injectable()
export class OrganizationPostByOrgIdInvitationsByInvitationIdByActionAction {
  execute(context: Parameters<typeof organizationRoutes.operations.postByOrgIdInvitationsByInvitationIdByAction.execute>[0]) {
    requireAdminAction('organizations.members.manage');
    return organizationRoutes.operations.postByOrgIdInvitationsByInvitationIdByAction.execute(context);
  }
}

@Injectable()
export class OrganizationPutByOrgIdJitAction {
  execute(context: Parameters<typeof organizationRoutes.operations.putByOrgIdJit.execute>[0]) {
    requireAdminAction('organizations.settings.manage');
    return organizationRoutes.operations.putByOrgIdJit.execute(context);
  }
}

@Injectable()
export class OrganizationPutByOrgIdApplicationsByAppIdAction {
  execute(context: Parameters<typeof organizationRoutes.operations.putByOrgIdApplicationsByAppId.execute>[0]) {
    requireAdminAction('organizations.settings.manage');
    return organizationRoutes.operations.putByOrgIdApplicationsByAppId.execute(context);
  }
}

@Injectable()
export class OrganizationDeleteByOrgIdApplicationsByAppIdAction {
  execute(context: Parameters<typeof organizationRoutes.operations.deleteByOrgIdApplicationsByAppId.execute>[0]) {
    requireAdminAction('organizations.settings.manage');
    return organizationRoutes.operations.deleteByOrgIdApplicationsByAppId.execute(context);
  }
}

@Injectable()
export class OrganizationPutByOrgIdBrandingAction {
  execute(context: Parameters<typeof organizationRoutes.operations.putByOrgIdBranding.execute>[0]) {
    requireAdminAction('organizations.settings.manage');
    return organizationRoutes.operations.putByOrgIdBranding.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/organizations")
export class OrganizationController {
  constructor(
    private readonly postRootAction: OrganizationPostRootAction,
    private readonly putByOrgIdAction: OrganizationPutByOrgIdAction,
    private readonly deleteByOrgIdAction: OrganizationDeleteByOrgIdAction,
    private readonly postByOrgIdMembersAction: OrganizationPostByOrgIdMembersAction,
    private readonly deleteByOrgIdMembersByUserIdAction: OrganizationDeleteByOrgIdMembersByUserIdAction,
    private readonly patchByOrgIdMembersByUserIdAction: OrganizationPatchByOrgIdMembersByUserIdAction,
    private readonly postByOrgIdInvitationsAction: OrganizationPostByOrgIdInvitationsAction,
    private readonly deleteByOrgIdInvitationsByInvitationIdAction: OrganizationDeleteByOrgIdInvitationsByInvitationIdAction,
    private readonly postByOrgIdInvitationsByInvitationIdByActionAction: OrganizationPostByOrgIdInvitationsByInvitationIdByActionAction,
    private readonly putByOrgIdJitAction: OrganizationPutByOrgIdJitAction,
    private readonly putByOrgIdApplicationsByAppIdAction: OrganizationPutByOrgIdApplicationsByAppIdAction,
    private readonly deleteByOrgIdApplicationsByAppIdAction: OrganizationDeleteByOrgIdApplicationsByAppIdAction,
    private readonly putByOrgIdBrandingAction: OrganizationPutByOrgIdBrandingAction,
  ) {}

  @Get("/", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/organizations.ts#getRoot" },
    aspects: [adminHttpAspect],
  })
  getRoot(ctx: HttpInvocation): Promise<Response> {
    return organizationRoutes.operations.getRoot.invoke(ctx);
  }

  @Post("/", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/organizations.ts#postRoot" },
    aspects: [adminHttpAspect],
  })
  postRoot(ctx: HttpInvocation): Promise<Response> {
    return organizationRoutes.operations.postRoot.invoke(ctx, context => this.postRootAction.execute(context));
  }

  @Get("/:orgId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/organizations.ts#getByOrgId" },
    aspects: [adminHttpAspect],
  })
  getByOrgId(ctx: HttpInvocation): Promise<Response> {
    return organizationRoutes.operations.getByOrgId.invoke(ctx);
  }

  @Put("/:orgId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/organizations.ts#putByOrgId" },
    aspects: [adminHttpAspect],
  })
  putByOrgId(ctx: HttpInvocation): Promise<Response> {
    return organizationRoutes.operations.putByOrgId.invoke(ctx, context => this.putByOrgIdAction.execute(context));
  }

  @Delete("/:orgId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/organizations.ts#deleteByOrgId" },
    aspects: [adminHttpAspect],
  })
  deleteByOrgId(ctx: HttpInvocation): Promise<Response> {
    return organizationRoutes.operations.deleteByOrgId.invoke(ctx, context => this.deleteByOrgIdAction.execute(context));
  }

  @Get("/:orgId/members", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/organizations.ts#getByOrgIdMembers" },
    aspects: [adminHttpAspect],
  })
  getByOrgIdMembers(ctx: HttpInvocation): Promise<Response> {
    return organizationRoutes.operations.getByOrgIdMembers.invoke(ctx);
  }

  @Post("/:orgId/members", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/organizations.ts#postByOrgIdMembers" },
    aspects: [adminHttpAspect],
  })
  postByOrgIdMembers(ctx: HttpInvocation): Promise<Response> {
    return organizationRoutes.operations.postByOrgIdMembers.invoke(ctx, context => this.postByOrgIdMembersAction.execute(context));
  }

  @Delete("/:orgId/members/:userId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/organizations.ts#deleteByOrgIdMembersByUserId" },
    aspects: [adminHttpAspect],
  })
  deleteByOrgIdMembersByUserId(ctx: HttpInvocation): Promise<Response> {
    return organizationRoutes.operations.deleteByOrgIdMembersByUserId.invoke(ctx, context => this.deleteByOrgIdMembersByUserIdAction.execute(context));
  }

  @Patch("/:orgId/members/:userId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/organizations.ts#patchByOrgIdMembersByUserId" },
    aspects: [adminHttpAspect],
  })
  patchByOrgIdMembersByUserId(ctx: HttpInvocation): Promise<Response> {
    return organizationRoutes.operations.patchByOrgIdMembersByUserId.invoke(ctx, context => this.patchByOrgIdMembersByUserIdAction.execute(context));
  }

  @Get("/:orgId/roles", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/organizations.ts#getByOrgIdRoles" },
    aspects: [adminHttpAspect],
  })
  getByOrgIdRoles(ctx: HttpInvocation): Promise<Response> {
    return organizationRoutes.operations.getByOrgIdRoles.invoke(ctx);
  }

  @Get("/:orgId/invitations", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/organizations.ts#getByOrgIdInvitations" },
    aspects: [adminHttpAspect],
  })
  getByOrgIdInvitations(ctx: HttpInvocation): Promise<Response> {
    return organizationRoutes.operations.getByOrgIdInvitations.invoke(ctx);
  }

  @Post("/:orgId/invitations", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/organizations.ts#postByOrgIdInvitations" },
    aspects: [adminHttpAspect],
  })
  postByOrgIdInvitations(ctx: HttpInvocation): Promise<Response> {
    return organizationRoutes.operations.postByOrgIdInvitations.invoke(ctx, context => this.postByOrgIdInvitationsAction.execute(context));
  }

  @Delete("/:orgId/invitations/:invitationId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/organizations.ts#deleteByOrgIdInvitationsByInvitationId" },
    aspects: [adminHttpAspect],
  })
  deleteByOrgIdInvitationsByInvitationId(ctx: HttpInvocation): Promise<Response> {
    return organizationRoutes.operations.deleteByOrgIdInvitationsByInvitationId.invoke(ctx, context => this.deleteByOrgIdInvitationsByInvitationIdAction.execute(context));
  }

  @Post("/:orgId/invitations/:invitationId/:action", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/organizations.ts#postByOrgIdInvitationsByInvitationIdByAction" },
    aspects: [adminHttpAspect],
  })
  postByOrgIdInvitationsByInvitationIdByAction(ctx: HttpInvocation): Promise<Response> {
    return organizationRoutes.operations.postByOrgIdInvitationsByInvitationIdByAction.invoke(ctx, context => this.postByOrgIdInvitationsByInvitationIdByActionAction.execute(context));
  }

  @Get("/:orgId/jit", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/organizations.ts#getByOrgIdJit" },
    aspects: [adminHttpAspect],
  })
  getByOrgIdJit(ctx: HttpInvocation): Promise<Response> {
    return organizationRoutes.operations.getByOrgIdJit.invoke(ctx);
  }

  @Put("/:orgId/jit", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/organizations.ts#putByOrgIdJit" },
    aspects: [adminHttpAspect],
  })
  putByOrgIdJit(ctx: HttpInvocation): Promise<Response> {
    return organizationRoutes.operations.putByOrgIdJit.invoke(ctx, context => this.putByOrgIdJitAction.execute(context));
  }

  @Get("/:orgId/applications", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/organizations.ts#getByOrgIdApplications" },
    aspects: [adminHttpAspect],
  })
  getByOrgIdApplications(ctx: HttpInvocation): Promise<Response> {
    return organizationRoutes.operations.getByOrgIdApplications.invoke(ctx);
  }

  @Put("/:orgId/applications/:appId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/organizations.ts#putByOrgIdApplicationsByAppId" },
    aspects: [adminHttpAspect],
  })
  putByOrgIdApplicationsByAppId(ctx: HttpInvocation): Promise<Response> {
    return organizationRoutes.operations.putByOrgIdApplicationsByAppId.invoke(ctx, context => this.putByOrgIdApplicationsByAppIdAction.execute(context));
  }

  @Delete("/:orgId/applications/:appId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/organizations.ts#deleteByOrgIdApplicationsByAppId" },
    aspects: [adminHttpAspect],
  })
  deleteByOrgIdApplicationsByAppId(ctx: HttpInvocation): Promise<Response> {
    return organizationRoutes.operations.deleteByOrgIdApplicationsByAppId.invoke(ctx, context => this.deleteByOrgIdApplicationsByAppIdAction.execute(context));
  }

  @Get("/:orgId/branding", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/organizations.ts#getByOrgIdBranding" },
    aspects: [adminHttpAspect],
  })
  getByOrgIdBranding(ctx: HttpInvocation): Promise<Response> {
    return organizationRoutes.operations.getByOrgIdBranding.invoke(ctx);
  }

  @Put("/:orgId/branding", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/organizations.ts#putByOrgIdBranding" },
    aspects: [adminHttpAspect],
  })
  putByOrgIdBranding(ctx: HttpInvocation): Promise<Response> {
    return organizationRoutes.operations.putByOrgIdBranding.invoke(ctx, context => this.putByOrgIdBrandingAction.execute(context));
  }

}

export const OrganizationModule = defineModule({
  name: 'supauth-organization',
  tags: ['type:feature', 'scope:supauth-organization'],
  providers: [OrganizationPostRootAction, OrganizationPutByOrgIdAction, OrganizationDeleteByOrgIdAction, OrganizationPostByOrgIdMembersAction, OrganizationDeleteByOrgIdMembersByUserIdAction, OrganizationPatchByOrgIdMembersByUserIdAction, OrganizationPostByOrgIdInvitationsAction, OrganizationDeleteByOrgIdInvitationsByInvitationIdAction, OrganizationPostByOrgIdInvitationsByInvitationIdByActionAction, OrganizationPutByOrgIdJitAction, OrganizationPutByOrgIdApplicationsByAppIdAction, OrganizationDeleteByOrgIdApplicationsByAppIdAction, OrganizationPutByOrgIdBrandingAction],
  controllers: [PublicOrganizationController, OrganizationController],
});
