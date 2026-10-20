import { Controller, defineModule, Injectable, Get, Patch, Delete, Post } from '@supacloud/app';
import { tenantRoutes } from '../../routes/tenant.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';

@Injectable()
export class TenantPatchMembersByMemberIdAction {
  execute(context: Parameters<typeof tenantRoutes.operations.patchMembersByMemberId.execute>[0]) {
    requireAdminAction('tenant.members.manage');
    return tenantRoutes.operations.patchMembersByMemberId.execute(context);
  }
}

@Injectable()
export class TenantDeleteMembersByMemberIdAction {
  execute(context: Parameters<typeof tenantRoutes.operations.deleteMembersByMemberId.execute>[0]) {
    requireAdminAction('tenant.members.manage');
    return tenantRoutes.operations.deleteMembersByMemberId.execute(context);
  }
}

@Injectable()
export class TenantPostInvitationsAction {
  execute(context: Parameters<typeof tenantRoutes.operations.postInvitations.execute>[0]) {
    requireAdminAction('tenant.members.manage');
    return tenantRoutes.operations.postInvitations.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/tenant")
export class TenantController {
  constructor(
    private readonly patchMembersByMemberIdAction: TenantPatchMembersByMemberIdAction,
    private readonly deleteMembersByMemberIdAction: TenantDeleteMembersByMemberIdAction,
    private readonly postInvitationsAction: TenantPostInvitationsAction,
  ) {}

  @Get("/members", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/tenant.ts#getMembers" },
    aspects: [adminHttpAspect],
  })
  getMembers(ctx: HttpInvocation): Promise<Response> {
    return tenantRoutes.operations.getMembers.invoke(ctx);
  }

  @Patch("/members/:memberId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/tenant.ts#patchMembersByMemberId" },
    aspects: [adminHttpAspect],
  })
  patchMembersByMemberId(ctx: HttpInvocation): Promise<Response> {
    return tenantRoutes.operations.patchMembersByMemberId.invoke(ctx, context => this.patchMembersByMemberIdAction.execute(context));
  }

  @Delete("/members/:memberId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/tenant.ts#deleteMembersByMemberId" },
    aspects: [adminHttpAspect],
  })
  deleteMembersByMemberId(ctx: HttpInvocation): Promise<Response> {
    return tenantRoutes.operations.deleteMembersByMemberId.invoke(ctx, context => this.deleteMembersByMemberIdAction.execute(context));
  }

  @Get("/invitations", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/tenant.ts#getInvitations" },
    aspects: [adminHttpAspect],
  })
  getInvitations(ctx: HttpInvocation): Promise<Response> {
    return tenantRoutes.operations.getInvitations.invoke(ctx);
  }

  @Post("/invitations", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/tenant.ts#postInvitations" },
    aspects: [adminHttpAspect],
  })
  postInvitations(ctx: HttpInvocation): Promise<Response> {
    return tenantRoutes.operations.postInvitations.invoke(ctx, context => this.postInvitationsAction.execute(context));
  }

}

export const TenantModule = defineModule({
  name: 'supauth-tenant',
  tags: ['type:feature', 'scope:supauth-tenant'],
  providers: [TenantPatchMembersByMemberIdAction, TenantDeleteMembersByMemberIdAction, TenantPostInvitationsAction],
  controllers: [TenantController],
});
