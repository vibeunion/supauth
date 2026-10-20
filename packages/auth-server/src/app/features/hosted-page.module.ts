import { Controller, defineModule, Injectable, Get } from '@supacloud/app';
import { hostedPageRoutes } from '../../routes/hosted-pages.js';
import type { HttpInvocation } from '../../http/operation.js';

@Injectable({ scope: 'application' })
@Controller("")
export class HostedPageController {
  @Get("/hosted-auth.js", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getHostedAuthJs" },
  })
  getHostedAuthJs(ctx: HttpInvocation): Promise<Response> {
    return hostedPageRoutes.operations.getHostedAuthJs.invoke(ctx);
  }

  @Get("/favicon.ico", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getFaviconIco" },
  })
  getFaviconIco(ctx: HttpInvocation): Promise<Response> {
    return hostedPageRoutes.operations.getFaviconIco.invoke(ctx);
  }

  @Get("/favicon.svg", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getFaviconSvg" },
  })
  getFaviconSvg(ctx: HttpInvocation): Promise<Response> {
    return hostedPageRoutes.operations.getFaviconSvg.invoke(ctx);
  }

  @Get("/oauth/authorize", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getOauthAuthorize" },
  })
  getOauthAuthorize(ctx: HttpInvocation): Promise<Response> {
    return hostedPageRoutes.operations.getOauthAuthorize.invoke(ctx);
  }

  @Get("/login.html", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getLoginHtml" },
  })
  getLoginHtml(ctx: HttpInvocation): Promise<Response> {
    return hostedPageRoutes.operations.getLoginHtml.invoke(ctx);
  }

  @Get("/login", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getLogin" },
  })
  getLogin(ctx: HttpInvocation): Promise<Response> {
    return hostedPageRoutes.operations.getLogin.invoke(ctx);
  }

  @Get("/authorize.html", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getAuthorizeHtml" },
  })
  getAuthorizeHtml(ctx: HttpInvocation): Promise<Response> {
    return hostedPageRoutes.operations.getAuthorizeHtml.invoke(ctx);
  }

  @Get("/logout", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getLogout" },
  })
  getLogout(ctx: HttpInvocation): Promise<Response> {
    return hostedPageRoutes.operations.getLogout.invoke(ctx);
  }

  @Get("/logout.html", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getLogoutHtml" },
  })
  getLogoutHtml(ctx: HttpInvocation): Promise<Response> {
    return hostedPageRoutes.operations.getLogoutHtml.invoke(ctx);
  }

  @Get("/claim", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getClaim" },
  })
  getClaim(ctx: HttpInvocation): Promise<Response> {
    return hostedPageRoutes.operations.getClaim.invoke(ctx);
  }

  @Get("/claim.html", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getClaimHtml" },
  })
  getClaimHtml(ctx: HttpInvocation): Promise<Response> {
    return hostedPageRoutes.operations.getClaimHtml.invoke(ctx);
  }

  @Get("/account", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getAccount" },
  })
  getAccount(ctx: HttpInvocation): Promise<Response> {
    return hostedPageRoutes.operations.getAccount.invoke(ctx);
  }

  @Get("/account.html", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getAccountHtml" },
  })
  getAccountHtml(ctx: HttpInvocation): Promise<Response> {
    return hostedPageRoutes.operations.getAccountHtml.invoke(ctx);
  }

  @Get("/account/password", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getAccountPassword" },
  })
  getAccountPassword(ctx: HttpInvocation): Promise<Response> {
    return hostedPageRoutes.operations.getAccountPassword.invoke(ctx);
  }

  @Get("/change-password", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getChangePassword" },
  })
  getChangePassword(ctx: HttpInvocation): Promise<Response> {
    return hostedPageRoutes.operations.getChangePassword.invoke(ctx);
  }

  @Get("/change-password.html", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getChangePasswordHtml" },
  })
  getChangePasswordHtml(ctx: HttpInvocation): Promise<Response> {
    return hostedPageRoutes.operations.getChangePasswordHtml.invoke(ctx);
  }

  @Get("/", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getRoot" },
  })
  getRoot(ctx: HttpInvocation): Promise<Response> {
    return hostedPageRoutes.operations.getRoot.invoke(ctx);
  }

  @Get("/custom-ui/*", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getCustomUiWildcard" },
  })
  getCustomUiWildcard(ctx: HttpInvocation): Promise<Response> {
    return hostedPageRoutes.operations.getCustomUiWildcard.invoke(ctx);
  }

  @Get("/_app/*", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getAppWildcard" },
  })
  getAppWildcard(ctx: HttpInvocation): Promise<Response> {
    return hostedPageRoutes.operations.getAppWildcard.invoke(ctx);
  }

  @Get("/admin", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getAdmin" },
  })
  getAdmin(ctx: HttpInvocation): Promise<Response> {
    return hostedPageRoutes.operations.getAdmin.invoke(ctx);
  }

  @Get("/admin/*", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getAdminWildcard" },
  })
  getAdminWildcard(ctx: HttpInvocation): Promise<Response> {
    return hostedPageRoutes.operations.getAdminWildcard.invoke(ctx);
  }

  @Get("/robots.txt", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/hosted-pages.ts#getRobotsTxt" },
  })
  getRobotsTxt(ctx: HttpInvocation): Promise<Response> {
    return hostedPageRoutes.operations.getRobotsTxt.invoke(ctx);
  }

}

export const HostedPageModule = defineModule({
  name: 'supauth-hosted-page',
  tags: ['type:feature', 'scope:supauth-hosted-page'],
  providers: [],
  controllers: [HostedPageController],
});
