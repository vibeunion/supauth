import { Controller, defineModule, Injectable, Get, Patch, Post, Delete, Put } from '@supacloud/app';
import { publicAccountRoutes } from '../../routes/account-self-service.js';
import type { HttpInvocation } from '../../http/operation.js';

@Injectable({ scope: 'application' })
@Controller("/v1/public/account")
export class PublicAccountController {
  @Get("/config", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#getConfig" },
  })
  getConfig(ctx: HttpInvocation): Promise<Response> {
    return publicAccountRoutes.operations.getConfig.invoke(ctx);
  }

  @Get("/me", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#getMe" },
  })
  getMe(ctx: HttpInvocation): Promise<Response> {
    return publicAccountRoutes.operations.getMe.invoke(ctx);
  }

  @Get("/permissions", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#getPermissions" },
  })
  getPermissions(ctx: HttpInvocation): Promise<Response> {
    return publicAccountRoutes.operations.getPermissions.invoke(ctx);
  }

  @Patch("/profile", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#patchProfile" },
  })
  patchProfile(ctx: HttpInvocation): Promise<Response> {
    return publicAccountRoutes.operations.patchProfile.invoke(ctx);
  }

  @Patch("/email", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#patchEmail" },
  })
  patchEmail(ctx: HttpInvocation): Promise<Response> {
    return publicAccountRoutes.operations.patchEmail.invoke(ctx);
  }

  @Patch("/phone", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#patchPhone" },
  })
  patchPhone(ctx: HttpInvocation): Promise<Response> {
    return publicAccountRoutes.operations.patchPhone.invoke(ctx);
  }

  @Get("/sessions", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#getSessions" },
  })
  getSessions(ctx: HttpInvocation): Promise<Response> {
    return publicAccountRoutes.operations.getSessions.invoke(ctx);
  }

  @Post("/sessions/:sessionId/revoke", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#postSessionsBySessionIdRevoke" },
  })
  postSessionsBySessionIdRevoke(ctx: HttpInvocation): Promise<Response> {
    return publicAccountRoutes.operations.postSessionsBySessionIdRevoke.invoke(ctx);
  }

  @Get("/grants", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#getGrants" },
  })
  getGrants(ctx: HttpInvocation): Promise<Response> {
    return publicAccountRoutes.operations.getGrants.invoke(ctx);
  }

  @Delete("/grants/:clientId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#deleteGrantsByClientId" },
  })
  deleteGrantsByClientId(ctx: HttpInvocation): Promise<Response> {
    return publicAccountRoutes.operations.deleteGrantsByClientId.invoke(ctx);
  }

  @Get("/identities", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#getIdentities" },
  })
  getIdentities(ctx: HttpInvocation): Promise<Response> {
    return publicAccountRoutes.operations.getIdentities.invoke(ctx);
  }

  @Post("/identities/authorize", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#postIdentitiesAuthorize" },
  })
  postIdentitiesAuthorize(ctx: HttpInvocation): Promise<Response> {
    return publicAccountRoutes.operations.postIdentitiesAuthorize.invoke(ctx);
  }

  @Delete("/identities/:identityId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#deleteIdentitiesByIdentityId" },
  })
  deleteIdentitiesByIdentityId(ctx: HttpInvocation): Promise<Response> {
    return publicAccountRoutes.operations.deleteIdentitiesByIdentityId.invoke(ctx);
  }

  @Post("/logout", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#postLogout" },
  })
  postLogout(ctx: HttpInvocation): Promise<Response> {
    return publicAccountRoutes.operations.postLogout.invoke(ctx);
  }

  @Get("/passkeys", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#getPasskeys" },
  })
  getPasskeys(ctx: HttpInvocation): Promise<Response> {
    return publicAccountRoutes.operations.getPasskeys.invoke(ctx);
  }

  @Put("/passkeys/:passkeyId/rename", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#putPasskeysByPasskeyIdRename" },
  })
  putPasskeysByPasskeyIdRename(ctx: HttpInvocation): Promise<Response> {
    return publicAccountRoutes.operations.putPasskeysByPasskeyIdRename.invoke(ctx);
  }

  @Delete("/passkeys/:passkeyId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#deletePasskeysByPasskeyId" },
  })
  deletePasskeysByPasskeyId(ctx: HttpInvocation): Promise<Response> {
    return publicAccountRoutes.operations.deletePasskeysByPasskeyId.invoke(ctx);
  }

  @Get("/mfa", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#getMfa" },
  })
  getMfa(ctx: HttpInvocation): Promise<Response> {
    return publicAccountRoutes.operations.getMfa.invoke(ctx);
  }

  @Post("/mfa/totp/enroll", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#postMfaTotpEnroll" },
  })
  postMfaTotpEnroll(ctx: HttpInvocation): Promise<Response> {
    return publicAccountRoutes.operations.postMfaTotpEnroll.invoke(ctx);
  }

  @Post("/mfa/:factorId/verify", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#postMfaByFactorIdVerify" },
  })
  postMfaByFactorIdVerify(ctx: HttpInvocation): Promise<Response> {
    return publicAccountRoutes.operations.postMfaByFactorIdVerify.invoke(ctx);
  }

  @Delete("/mfa/:factorId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#deleteMfaByFactorId" },
  })
  deleteMfaByFactorId(ctx: HttpInvocation): Promise<Response> {
    return publicAccountRoutes.operations.deleteMfaByFactorId.invoke(ctx);
  }

  @Delete("/", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/account-self-service.ts#deleteRoot" },
  })
  deleteRoot(ctx: HttpInvocation): Promise<Response> {
    return publicAccountRoutes.operations.deleteRoot.invoke(ctx);
  }

}

export const PublicAccountModule = defineModule({
  name: 'supauth-public-account',
  tags: ['type:feature', 'scope:supauth-public-account'],
  providers: [],
  controllers: [PublicAccountController],
});
