import { Controller, defineModule, Injectable, Get, Post, Delete } from '@supacloud/app';
import { consentRoutes } from '../../routes/consents.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';

@Injectable()
export class ConsentPostDecisionAction {
  execute(context: Parameters<typeof consentRoutes.operations.postDecision.execute>[0]) {
    requireAdminAction('consents.manage');
    return consentRoutes.operations.postDecision.execute(context);
  }
}

@Injectable()
export class ConsentDeleteRootAction {
  execute(context: Parameters<typeof consentRoutes.operations.deleteRoot.execute>[0]) {
    requireAdminAction('consents.manage');
    return consentRoutes.operations.deleteRoot.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/consents")
export class ConsentController {
  constructor(
    private readonly postDecisionAction: ConsentPostDecisionAction,
    private readonly deleteRootAction: ConsentDeleteRootAction,
  ) {}

  @Get("/", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/consents.ts#getRoot" },
    aspects: [adminHttpAspect],
  })
  getRoot(ctx: HttpInvocation): Promise<Response> {
    return consentRoutes.operations.getRoot.invoke(ctx);
  }

  @Get("/check", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/consents.ts#getCheck" },
    aspects: [adminHttpAspect],
  })
  getCheck(ctx: HttpInvocation): Promise<Response> {
    return consentRoutes.operations.getCheck.invoke(ctx);
  }

  @Post("/decision", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/consents.ts#postDecision" },
    aspects: [adminHttpAspect],
  })
  postDecision(ctx: HttpInvocation): Promise<Response> {
    return consentRoutes.operations.postDecision.invoke(ctx, context => this.postDecisionAction.execute(context));
  }

  @Delete("/", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/consents.ts#deleteRoot" },
    aspects: [adminHttpAspect],
  })
  deleteRoot(ctx: HttpInvocation): Promise<Response> {
    return consentRoutes.operations.deleteRoot.invoke(ctx, context => this.deleteRootAction.execute(context));
  }

  @Get("/application/:applicationId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/consents.ts#getApplicationByApplicationId" },
    aspects: [adminHttpAspect],
  })
  getApplicationByApplicationId(ctx: HttpInvocation): Promise<Response> {
    return consentRoutes.operations.getApplicationByApplicationId.invoke(ctx);
  }

  @Get("/user/:userId/all", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/consents.ts#getUserByUserIdAll" },
    aspects: [adminHttpAspect],
  })
  getUserByUserIdAll(ctx: HttpInvocation): Promise<Response> {
    return consentRoutes.operations.getUserByUserIdAll.invoke(ctx);
  }

}

export const ConsentModule = defineModule({
  name: 'supauth-consent',
  tags: ['type:feature', 'scope:supauth-consent'],
  providers: [ConsentPostDecisionAction, ConsentDeleteRootAction],
  controllers: [ConsentController],
});
