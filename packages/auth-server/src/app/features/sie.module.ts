import { Controller, defineModule, Injectable, Get, Put, Post, Delete } from '@supacloud/app';
import { sieRoutes } from '../../routes/sign-in-experience.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';

@Injectable()
export class SiePutRootAction {
  execute(context: Parameters<typeof sieRoutes.operations.putRoot.execute>[0]) {
    requireAdminAction('security.manage');
    return sieRoutes.operations.putRoot.execute(context);
  }
}

@Injectable()
export class SiePostCustomUiAssetsAction {
  execute(context: Parameters<typeof sieRoutes.operations.postCustomUiAssets.execute>[0]) {
    requireAdminAction('security.manage');
    return sieRoutes.operations.postCustomUiAssets.execute(context);
  }
}

@Injectable()
export class SieDeleteCustomUiAssetsAction {
  execute(context: Parameters<typeof sieRoutes.operations.deleteCustomUiAssets.execute>[0]) {
    requireAdminAction('security.manage');
    return sieRoutes.operations.deleteCustomUiAssets.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/sign-in-experience")
export class SieController {
  constructor(
    private readonly putRootAction: SiePutRootAction,
    private readonly postCustomUiAssetsAction: SiePostCustomUiAssetsAction,
    private readonly deleteCustomUiAssetsAction: SieDeleteCustomUiAssetsAction,
  ) {}

  @Get("/", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sign-in-experience.ts#getRoot" },
    aspects: [adminHttpAspect],
  })
  getRoot(ctx: HttpInvocation): Promise<Response> {
    return sieRoutes.operations.getRoot.invoke(ctx);
  }

  @Get("/resolve", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sign-in-experience.ts#getResolve" },
    aspects: [adminHttpAspect],
  })
  getResolve(ctx: HttpInvocation): Promise<Response> {
    return sieRoutes.operations.getResolve.invoke(ctx);
  }

  @Put("/", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sign-in-experience.ts#putRoot" },
    aspects: [adminHttpAspect],
  })
  putRoot(ctx: HttpInvocation): Promise<Response> {
    return sieRoutes.operations.putRoot.invoke(ctx, context => this.putRootAction.execute(context));
  }

  @Get("/custom-ui-assets", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sign-in-experience.ts#getCustomUiAssets" },
    aspects: [adminHttpAspect],
  })
  getCustomUiAssets(ctx: HttpInvocation): Promise<Response> {
    return sieRoutes.operations.getCustomUiAssets.invoke(ctx);
  }

  @Post("/custom-ui-assets", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sign-in-experience.ts#postCustomUiAssets" },
    aspects: [adminHttpAspect],
  })
  postCustomUiAssets(ctx: HttpInvocation): Promise<Response> {
    return sieRoutes.operations.postCustomUiAssets.invoke(ctx, context => this.postCustomUiAssetsAction.execute(context));
  }

  @Delete("/custom-ui-assets", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/sign-in-experience.ts#deleteCustomUiAssets" },
    aspects: [adminHttpAspect],
  })
  deleteCustomUiAssets(ctx: HttpInvocation): Promise<Response> {
    return sieRoutes.operations.deleteCustomUiAssets.invoke(ctx, context => this.deleteCustomUiAssetsAction.execute(context));
  }

}

export const SieModule = defineModule({
  name: 'supauth-sie',
  tags: ['type:feature', 'scope:supauth-sie'],
  providers: [SiePutRootAction, SiePostCustomUiAssetsAction, SieDeleteCustomUiAssetsAction],
  controllers: [SieController],
});
