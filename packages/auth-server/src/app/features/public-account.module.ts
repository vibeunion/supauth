import { Controller, defineModule, Injectable, Get, Patch, Post, Delete, Put } from '@supacloud/app';
import { publicAccountRoutes } from '../../routes/account-self-service.js';
import type { HttpInvocation } from '../../http/operation.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable({ scope: 'application' })
@Controller("/v1/public/account")
export class PublicAccountController {
  @Get("/config", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#getConfig" },
  })
  getConfig(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicAccountRoutes.operations.getConfig.invoke(ctx));
  }

  @Get("/me", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#getMe" },
  })
  getMe(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicAccountRoutes.operations.getMe.invoke(ctx));
  }

  @Get("/permissions", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#getPermissions" },
  })
  getPermissions(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicAccountRoutes.operations.getPermissions.invoke(ctx));
  }

  @Patch("/profile", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#patchProfile" },
  })
  patchProfile(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicAccountRoutes.operations.patchProfile.invoke(ctx));
  }

  @Patch("/email", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#patchEmail" },
  })
  patchEmail(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicAccountRoutes.operations.patchEmail.invoke(ctx));
  }

  @Patch("/phone", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#patchPhone" },
  })
  patchPhone(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicAccountRoutes.operations.patchPhone.invoke(ctx));
  }

  @Get("/sessions", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#getSessions" },
  })
  getSessions(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicAccountRoutes.operations.getSessions.invoke(ctx));
  }

  @Post("/sessions/:sessionId/revoke", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#postSessionsBySessionIdRevoke" },
  })
  postSessionsBySessionIdRevoke(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicAccountRoutes.operations.postSessionsBySessionIdRevoke.invoke(ctx));
  }

  @Get("/grants", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#getGrants" },
  })
  getGrants(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicAccountRoutes.operations.getGrants.invoke(ctx));
  }

  @Delete("/grants/:clientId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#deleteGrantsByClientId" },
  })
  deleteGrantsByClientId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicAccountRoutes.operations.deleteGrantsByClientId.invoke(ctx));
  }

  @Get("/identities", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#getIdentities" },
  })
  getIdentities(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicAccountRoutes.operations.getIdentities.invoke(ctx));
  }

  @Post("/identities/authorize", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#postIdentitiesAuthorize" },
  })
  postIdentitiesAuthorize(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicAccountRoutes.operations.postIdentitiesAuthorize.invoke(ctx));
  }

  @Delete("/identities/:identityId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#deleteIdentitiesByIdentityId" },
  })
  deleteIdentitiesByIdentityId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicAccountRoutes.operations.deleteIdentitiesByIdentityId.invoke(ctx));
  }

  @Post("/logout", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#postLogout" },
  })
  postLogout(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicAccountRoutes.operations.postLogout.invoke(ctx));
  }

  @Get("/passkeys", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#getPasskeys" },
  })
  getPasskeys(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicAccountRoutes.operations.getPasskeys.invoke(ctx));
  }

  @Put("/passkeys/:passkeyId/rename", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#putPasskeysByPasskeyIdRename" },
  })
  putPasskeysByPasskeyIdRename(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicAccountRoutes.operations.putPasskeysByPasskeyIdRename.invoke(ctx));
  }

  @Delete("/passkeys/:passkeyId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#deletePasskeysByPasskeyId" },
  })
  deletePasskeysByPasskeyId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicAccountRoutes.operations.deletePasskeysByPasskeyId.invoke(ctx));
  }

  @Get("/mfa", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#getMfa" },
  })
  getMfa(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicAccountRoutes.operations.getMfa.invoke(ctx));
  }

  @Post("/mfa/totp/enroll", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#postMfaTotpEnroll" },
  })
  postMfaTotpEnroll(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicAccountRoutes.operations.postMfaTotpEnroll.invoke(ctx));
  }

  @Post("/mfa/:factorId/verify", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#postMfaByFactorIdVerify" },
  })
  postMfaByFactorIdVerify(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicAccountRoutes.operations.postMfaByFactorIdVerify.invoke(ctx));
  }

  @Delete("/mfa/:factorId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#deleteMfaByFactorId" },
  })
  deleteMfaByFactorId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicAccountRoutes.operations.deleteMfaByFactorId.invoke(ctx));
  }

  @Delete("/", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#deleteRoot" },
  })
  deleteRoot(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => publicAccountRoutes.operations.deleteRoot.invoke(ctx));
  }

}

export const PublicAccountModule = defineModule({
  name: 'supauth-public-account',
  tags: ['type:feature', 'scope:supauth-public-account'],
  providers: [],
  controllers: [PublicAccountController],
});
