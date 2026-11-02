import { Controller, defineModule, Injectable, Get } from '@supacloud/app';
import { hostedPageRoutes } from '../../routes/hosted-pages.js';
import type { HttpInvocation } from '../../http/operation.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable({ scope: 'application' })
@Controller("")
export class HostedPageController {
  @Get("/hosted-auth.js", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getHostedAuthJs" },
  })
  getHostedAuthJs(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => hostedPageRoutes.operations.getHostedAuthJs.invoke(ctx));
  }

  @Get("/favicon.ico", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getFaviconIco" },
  })
  getFaviconIco(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => hostedPageRoutes.operations.getFaviconIco.invoke(ctx));
  }

  @Get("/favicon.svg", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getFaviconSvg" },
  })
  getFaviconSvg(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => hostedPageRoutes.operations.getFaviconSvg.invoke(ctx));
  }

  @Get("/oauth/authorize", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getOauthAuthorize" },
  })
  getOauthAuthorize(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => hostedPageRoutes.operations.getOauthAuthorize.invoke(ctx));
  }

  @Get("/login.html", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getLoginHtml" },
  })
  getLoginHtml(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => hostedPageRoutes.operations.getLoginHtml.invoke(ctx));
  }

  @Get("/login", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getLogin" },
  })
  getLogin(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => hostedPageRoutes.operations.getLogin.invoke(ctx));
  }

  @Get("/authorize.html", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getAuthorizeHtml" },
  })
  getAuthorizeHtml(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => hostedPageRoutes.operations.getAuthorizeHtml.invoke(ctx));
  }

  @Get("/logout", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getLogout" },
  })
  getLogout(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => hostedPageRoutes.operations.getLogout.invoke(ctx));
  }

  @Get("/logout.html", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getLogoutHtml" },
  })
  getLogoutHtml(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => hostedPageRoutes.operations.getLogoutHtml.invoke(ctx));
  }

  @Get("/claim", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getClaim" },
  })
  getClaim(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => hostedPageRoutes.operations.getClaim.invoke(ctx));
  }

  @Get("/claim.html", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getClaimHtml" },
  })
  getClaimHtml(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => hostedPageRoutes.operations.getClaimHtml.invoke(ctx));
  }

  @Get("/account", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getAccount" },
  })
  getAccount(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => hostedPageRoutes.operations.getAccount.invoke(ctx));
  }

  @Get("/account.html", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getAccountHtml" },
  })
  getAccountHtml(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => hostedPageRoutes.operations.getAccountHtml.invoke(ctx));
  }

  @Get("/account/password", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getAccountPassword" },
  })
  getAccountPassword(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => hostedPageRoutes.operations.getAccountPassword.invoke(ctx));
  }

  @Get("/change-password", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getChangePassword" },
  })
  getChangePassword(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => hostedPageRoutes.operations.getChangePassword.invoke(ctx));
  }

  @Get("/change-password.html", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getChangePasswordHtml" },
  })
  getChangePasswordHtml(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => hostedPageRoutes.operations.getChangePasswordHtml.invoke(ctx));
  }

  @Get("/", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getRoot" },
  })
  getRoot(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => hostedPageRoutes.operations.getRoot.invoke(ctx));
  }

  @Get("/custom-ui/*", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getCustomUiWildcard" },
  })
  getCustomUiWildcard(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => hostedPageRoutes.operations.getCustomUiWildcard.invoke(ctx));
  }

  @Get("/_app/*", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getAppWildcard" },
  })
  getAppWildcard(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => hostedPageRoutes.operations.getAppWildcard.invoke(ctx));
  }

  @Get("/admin", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getAdmin" },
  })
  getAdmin(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => hostedPageRoutes.operations.getAdmin.invoke(ctx));
  }

  @Get("/admin/*", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getAdminWildcard" },
  })
  getAdminWildcard(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => hostedPageRoutes.operations.getAdminWildcard.invoke(ctx));
  }

  @Get("/robots.txt", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getRobotsTxt" },
  })
  getRobotsTxt(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => hostedPageRoutes.operations.getRobotsTxt.invoke(ctx));
  }

}

export const HostedPageModule = defineModule({
  name: 'supauth-hosted-page',
  tags: ['type:feature', 'scope:supauth-hosted-page'],
  providers: [],
  controllers: [HostedPageController],
});
