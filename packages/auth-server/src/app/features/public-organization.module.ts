import { Controller, defineModule, Injectable, Post } from '@supacloud/app';
import { publicOrganizationRoutes } from '../../routes/organizations.js';
import type { HttpInvocation } from '../../http/operation.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable({ scope: 'application' })
@Controller("/v1/organizations")
export class PublicOrganizationController {
  @Post("/:orgId/invitations/:invitationId/accept", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/organizations.ts#postByOrgIdInvitationsByInvitationIdAccept" },
  })
  postByOrgIdInvitationsByInvitationIdAccept(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicOrganizationRoutes.operations.postByOrgIdInvitationsByInvitationIdAccept.invoke(ctx));
  }

}
