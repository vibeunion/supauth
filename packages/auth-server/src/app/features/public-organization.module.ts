import { Controller, defineModule, Injectable, Post } from '@supacloud/app';
import { publicOrganizationRoutes } from '../../routes/organizations.js';
import type { HttpInvocation } from '../../http/operation.js';

@Injectable({ scope: 'application' })
@Controller("/v1/organizations")
export class PublicOrganizationController {
  @Post("/:orgId/invitations/:invitationId/accept", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/organizations.ts#postByOrgIdInvitationsByInvitationIdAccept" },
  })
  postByOrgIdInvitationsByInvitationIdAccept(ctx: HttpInvocation): Promise<Response> {
    return publicOrganizationRoutes.operations.postByOrgIdInvitationsByInvitationIdAccept.invoke(ctx);
  }

}
