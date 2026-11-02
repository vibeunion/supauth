import { Controller, defineModule, Injectable, Get } from '@supacloud/app';
import { healthRoutes } from '../../routes/health.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect } from '../admin-aspect.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable({ scope: 'application' })
@Controller("/v1")
export class HealthController {
  @Get("/health", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/health.ts#getHealth" },
    aspects: [adminHttpAspect],
  })
  getHealth(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => healthRoutes.operations.getHealth.invoke(ctx));
  }

  @Get("/project", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/health.ts#getProject" },
    aspects: [adminHttpAspect],
  })
  getProject(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => healthRoutes.operations.getProject.invoke(ctx));
  }

  @Get("/public/admin-sso-config", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/health.ts#getPublicAdminSsoConfig" },
    aspects: [adminHttpAspect],
  })
  getPublicAdminSsoConfig(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => healthRoutes.operations.getPublicAdminSsoConfig.invoke(ctx));
  }

}

export const HealthModule = defineModule({
  name: 'supauth-health',
  tags: ['type:feature', 'scope:supauth-health'],
  providers: [],
  controllers: [HealthController],
});
