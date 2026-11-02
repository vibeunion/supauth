import { Controller, defineModule, Injectable, Get, Post, Put, Delete } from '@supacloud/app';
import { applicationRoutes } from '../../routes/applications.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable()
export class ApplicationPostRootAction {
  execute(context: Parameters<typeof applicationRoutes.operations.postRoot.execute>[0]) {
    requireAdminAction('applications.manage');
    return applicationRoutes.operations.postRoot.execute(context);
  }
}

@Injectable()
export class ApplicationPutByAppIdAction {
  execute(context: Parameters<typeof applicationRoutes.operations.putByAppId.execute>[0]) {
    requireAdminAction('applications.manage');
    return applicationRoutes.operations.putByAppId.execute(context);
  }
}

@Injectable()
export class ApplicationDeleteByAppIdAction {
  execute(context: Parameters<typeof applicationRoutes.operations.deleteByAppId.execute>[0]) {
    requireAdminAction('applications.manage');
    return applicationRoutes.operations.deleteByAppId.execute(context);
  }
}

@Injectable()
export class ApplicationPostByAppIdRotateSecretAction {
  execute(context: Parameters<typeof applicationRoutes.operations.postByAppIdRotateSecret.execute>[0]) {
    requireAdminAction('applications.manage');
    return applicationRoutes.operations.postByAppIdRotateSecret.execute(context);
  }
}

@Injectable()
export class ApplicationPostByAppIdSecretsAction {
  execute(context: Parameters<typeof applicationRoutes.operations.postByAppIdSecrets.execute>[0]) {
    requireAdminAction('applications.manage');
    return applicationRoutes.operations.postByAppIdSecrets.execute(context);
  }
}

@Injectable()
export class ApplicationPostByAppIdSecretsBySecretIdDisableAction {
  execute(context: Parameters<typeof applicationRoutes.operations.postByAppIdSecretsBySecretIdDisable.execute>[0]) {
    requireAdminAction('applications.manage');
    return applicationRoutes.operations.postByAppIdSecretsBySecretIdDisable.execute(context);
  }
}

@Injectable()
export class ApplicationDeleteByAppIdSecretsBySecretIdAction {
  execute(context: Parameters<typeof applicationRoutes.operations.deleteByAppIdSecretsBySecretId.execute>[0]) {
    requireAdminAction('applications.manage');
    return applicationRoutes.operations.deleteByAppIdSecretsBySecretId.execute(context);
  }
}

@Injectable()
export class ApplicationPutByAppIdConsentAction {
  execute(context: Parameters<typeof applicationRoutes.operations.putByAppIdConsent.execute>[0]) {
    requireAdminAction('applications.manage');
    return applicationRoutes.operations.putByAppIdConsent.execute(context);
  }
}

@Injectable()
export class ApplicationPutByAppIdAccessControlAction {
  execute(context: Parameters<typeof applicationRoutes.operations.putByAppIdAccessControl.execute>[0]) {
    requireAdminAction('applications.manage');
    return applicationRoutes.operations.putByAppIdAccessControl.execute(context);
  }
}

@Injectable()
export class ApplicationPutByAppIdSignInExperienceAction {
  execute(context: Parameters<typeof applicationRoutes.operations.putByAppIdSignInExperience.execute>[0]) {
    requireAdminAction('applications.manage');
    return applicationRoutes.operations.putByAppIdSignInExperience.execute(context);
  }
}

@Injectable()
export class ApplicationDeleteByAppIdSignInExperienceAction {
  execute(context: Parameters<typeof applicationRoutes.operations.deleteByAppIdSignInExperience.execute>[0]) {
    requireAdminAction('applications.manage');
    return applicationRoutes.operations.deleteByAppIdSignInExperience.execute(context);
  }
}

@Injectable()
export class ApplicationPostByAppIdBindingsAction {
  execute(context: Parameters<typeof applicationRoutes.operations.postByAppIdBindings.execute>[0]) {
    requireAdminAction('applications.manage');
    return applicationRoutes.operations.postByAppIdBindings.execute(context);
  }
}

@Injectable()
export class ApplicationDeleteByAppIdBindingsByBindingIdAction {
  execute(context: Parameters<typeof applicationRoutes.operations.deleteByAppIdBindingsByBindingId.execute>[0]) {
    requireAdminAction('applications.manage');
    return applicationRoutes.operations.deleteByAppIdBindingsByBindingId.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/applications")
export class ApplicationController {
  constructor(
    private readonly postRootAction: ApplicationPostRootAction,
    private readonly putByAppIdAction: ApplicationPutByAppIdAction,
    private readonly deleteByAppIdAction: ApplicationDeleteByAppIdAction,
    private readonly postByAppIdRotateSecretAction: ApplicationPostByAppIdRotateSecretAction,
    private readonly postByAppIdSecretsAction: ApplicationPostByAppIdSecretsAction,
    private readonly postByAppIdSecretsBySecretIdDisableAction: ApplicationPostByAppIdSecretsBySecretIdDisableAction,
    private readonly deleteByAppIdSecretsBySecretIdAction: ApplicationDeleteByAppIdSecretsBySecretIdAction,
    private readonly putByAppIdConsentAction: ApplicationPutByAppIdConsentAction,
    private readonly putByAppIdAccessControlAction: ApplicationPutByAppIdAccessControlAction,
    private readonly putByAppIdSignInExperienceAction: ApplicationPutByAppIdSignInExperienceAction,
    private readonly deleteByAppIdSignInExperienceAction: ApplicationDeleteByAppIdSignInExperienceAction,
    private readonly postByAppIdBindingsAction: ApplicationPostByAppIdBindingsAction,
    private readonly deleteByAppIdBindingsByBindingIdAction: ApplicationDeleteByAppIdBindingsByBindingIdAction,
  ) {}

  @Get("/", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/applications.ts#getRoot" },
    aspects: [adminHttpAspect],
  })
  getRoot(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => applicationRoutes.operations.getRoot.invoke(ctx));
  }

  @Post("/", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/applications.ts#postRoot" },
    aspects: [adminHttpAspect],
  })
  postRoot(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => applicationRoutes.operations.postRoot.invoke(ctx, context => this.postRootAction.execute(context)));
  }

  @Get("/:appId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/applications.ts#getByAppId" },
    aspects: [adminHttpAspect],
  })
  getByAppId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => applicationRoutes.operations.getByAppId.invoke(ctx));
  }

  @Put("/:appId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/applications.ts#putByAppId" },
    aspects: [adminHttpAspect],
  })
  putByAppId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => applicationRoutes.operations.putByAppId.invoke(ctx, context => this.putByAppIdAction.execute(context)));
  }

  @Delete("/:appId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/applications.ts#deleteByAppId" },
    aspects: [adminHttpAspect],
  })
  deleteByAppId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => applicationRoutes.operations.deleteByAppId.invoke(ctx, context => this.deleteByAppIdAction.execute(context)));
  }

  @Post("/:appId/rotate-secret", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/applications.ts#postByAppIdRotateSecret" },
    aspects: [adminHttpAspect],
  })
  postByAppIdRotateSecret(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => applicationRoutes.operations.postByAppIdRotateSecret.invoke(ctx, context => this.postByAppIdRotateSecretAction.execute(context)));
  }

  @Get("/:appId/secrets", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/applications.ts#getByAppIdSecrets" },
    aspects: [adminHttpAspect],
  })
  getByAppIdSecrets(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => applicationRoutes.operations.getByAppIdSecrets.invoke(ctx));
  }

  @Post("/:appId/secrets", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/applications.ts#postByAppIdSecrets" },
    aspects: [adminHttpAspect],
  })
  postByAppIdSecrets(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => applicationRoutes.operations.postByAppIdSecrets.invoke(ctx, context => this.postByAppIdSecretsAction.execute(context)));
  }

  @Post("/:appId/secrets/:secretId/disable", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/applications.ts#postByAppIdSecretsBySecretIdDisable" },
    aspects: [adminHttpAspect],
  })
  postByAppIdSecretsBySecretIdDisable(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => applicationRoutes.operations.postByAppIdSecretsBySecretIdDisable.invoke(ctx, context => this.postByAppIdSecretsBySecretIdDisableAction.execute(context)));
  }

  @Delete("/:appId/secrets/:secretId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/applications.ts#deleteByAppIdSecretsBySecretId" },
    aspects: [adminHttpAspect],
  })
  deleteByAppIdSecretsBySecretId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => applicationRoutes.operations.deleteByAppIdSecretsBySecretId.invoke(ctx, context => this.deleteByAppIdSecretsBySecretIdAction.execute(context)));
  }

  @Get("/:appId/consent", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/applications.ts#getByAppIdConsent" },
    aspects: [adminHttpAspect],
  })
  getByAppIdConsent(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => applicationRoutes.operations.getByAppIdConsent.invoke(ctx));
  }

  @Put("/:appId/consent", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/applications.ts#putByAppIdConsent" },
    aspects: [adminHttpAspect],
  })
  putByAppIdConsent(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => applicationRoutes.operations.putByAppIdConsent.invoke(ctx, context => this.putByAppIdConsentAction.execute(context)));
  }

  @Get("/:appId/access-control", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/applications.ts#getByAppIdAccessControl" },
    aspects: [adminHttpAspect],
  })
  getByAppIdAccessControl(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => applicationRoutes.operations.getByAppIdAccessControl.invoke(ctx));
  }

  @Put("/:appId/access-control", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/applications.ts#putByAppIdAccessControl" },
    aspects: [adminHttpAspect],
  })
  putByAppIdAccessControl(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => applicationRoutes.operations.putByAppIdAccessControl.invoke(ctx, context => this.putByAppIdAccessControlAction.execute(context)));
  }

  @Get("/:appId/sign-in-experience", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/applications.ts#getByAppIdSignInExperience" },
    aspects: [adminHttpAspect],
  })
  getByAppIdSignInExperience(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => applicationRoutes.operations.getByAppIdSignInExperience.invoke(ctx));
  }

  @Put("/:appId/sign-in-experience", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/applications.ts#putByAppIdSignInExperience" },
    aspects: [adminHttpAspect],
  })
  putByAppIdSignInExperience(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => applicationRoutes.operations.putByAppIdSignInExperience.invoke(ctx, context => this.putByAppIdSignInExperienceAction.execute(context)));
  }

  @Delete("/:appId/sign-in-experience", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/applications.ts#deleteByAppIdSignInExperience" },
    aspects: [adminHttpAspect],
  })
  deleteByAppIdSignInExperience(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => applicationRoutes.operations.deleteByAppIdSignInExperience.invoke(ctx, context => this.deleteByAppIdSignInExperienceAction.execute(context)));
  }

  @Get("/:appId/bindings", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/applications.ts#getByAppIdBindings" },
    aspects: [adminHttpAspect],
  })
  getByAppIdBindings(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => applicationRoutes.operations.getByAppIdBindings.invoke(ctx));
  }

  @Post("/:appId/bindings", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/applications.ts#postByAppIdBindings" },
    aspects: [adminHttpAspect],
  })
  postByAppIdBindings(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => applicationRoutes.operations.postByAppIdBindings.invoke(ctx, context => this.postByAppIdBindingsAction.execute(context)));
  }

  @Delete("/:appId/bindings/:bindingId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/applications.ts#deleteByAppIdBindingsByBindingId" },
    aspects: [adminHttpAspect],
  })
  deleteByAppIdBindingsByBindingId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => applicationRoutes.operations.deleteByAppIdBindingsByBindingId.invoke(ctx, context => this.deleteByAppIdBindingsByBindingIdAction.execute(context)));
  }

  @Get("/:appId/scopes", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/applications.ts#getByAppIdScopes" },
    aspects: [adminHttpAspect],
  })
  getByAppIdScopes(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => applicationRoutes.operations.getByAppIdScopes.invoke(ctx));
  }

  @Get("/:appId/roles", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/applications.ts#getByAppIdRoles" },
    aspects: [adminHttpAspect],
  })
  getByAppIdRoles(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => applicationRoutes.operations.getByAppIdRoles.invoke(ctx));
  }

  @Get("/:appId/logs", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/applications.ts#getByAppIdLogs" },
    aspects: [adminHttpAspect],
  })
  getByAppIdLogs(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => applicationRoutes.operations.getByAppIdLogs.invoke(ctx));
  }

  @Get("/:appId/organizations", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/applications.ts#getByAppIdOrganizations" },
    aspects: [adminHttpAspect],
  })
  getByAppIdOrganizations(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => applicationRoutes.operations.getByAppIdOrganizations.invoke(ctx));
  }

}

export const ApplicationModule = defineModule({
  name: 'supauth-application',
  tags: ['type:feature', 'scope:supauth-application'],
  providers: [ApplicationPostRootAction, ApplicationPutByAppIdAction, ApplicationDeleteByAppIdAction, ApplicationPostByAppIdRotateSecretAction, ApplicationPostByAppIdSecretsAction, ApplicationPostByAppIdSecretsBySecretIdDisableAction, ApplicationDeleteByAppIdSecretsBySecretIdAction, ApplicationPutByAppIdConsentAction, ApplicationPutByAppIdAccessControlAction, ApplicationPutByAppIdSignInExperienceAction, ApplicationDeleteByAppIdSignInExperienceAction, ApplicationPostByAppIdBindingsAction, ApplicationDeleteByAppIdBindingsByBindingIdAction],
  controllers: [ApplicationController],
});
