import { Controller, defineModule, Injectable, Get, Post } from '@supacloud/app';
import { auditRoutes } from '../../routes/audit.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';
import { Effect } from 'effect';
import { routeEffect, type RouteFailure } from '../route-effect.js';

@Injectable()
export class AuditPostExportAction {
  execute(context: Parameters<typeof auditRoutes.operations.postExport.execute>[0]) {
    requireAdminAction('audit.export');
    return auditRoutes.operations.postExport.execute(context);
  }
}

@Injectable({ scope: 'application' })
@Controller("/v1/audit")
export class AuditController {
  constructor(
    private readonly postExportAction: AuditPostExportAction,
  ) {}

  @Get("/", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/audit.ts#getRoot" },
    aspects: [adminHttpAspect],
  })
  getRoot(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => auditRoutes.operations.getRoot.invoke(ctx));
  }

  @Post("/export", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/audit.ts#postExport" },
    aspects: [adminHttpAspect],
  })
  postExport(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => auditRoutes.operations.postExport.invoke(ctx, context => this.postExportAction.execute(context)));
  }

  @Get("/export", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/audit.ts#getExport" },
    aspects: [adminHttpAspect],
  })
  getExport(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => auditRoutes.operations.getExport.invoke(ctx));
  }

  @Get("/export/:exportId/download", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/audit.ts#getExportByExportIdDownload" },
    aspects: [adminHttpAspect],
  })
  getExportByExportIdDownload(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => auditRoutes.operations.getExportByExportIdDownload.invoke(ctx));
  }

  @Get("/export/:exportId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/audit.ts#getExportByExportId" },
    aspects: [adminHttpAspect],
  })
  getExportByExportId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => auditRoutes.operations.getExportByExportId.invoke(ctx));
  }

  @Get("/integrity", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/audit.ts#getIntegrity" },
    aspects: [adminHttpAspect],
  })
  getIntegrity(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => auditRoutes.operations.getIntegrity.invoke(ctx));
  }

  @Get("/:logId", {
    parse: 'none',
    effect: {
      required: true,
      errors: [{ tag: 'RouteFailure', status: 500, code: 'internal_error' }],
      dependencies: [],
      retry: 'none',
    },
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/audit.ts#getByLogId" },
    aspects: [adminHttpAspect],
  })
  getByLogId(ctx: HttpInvocation): Effect.Effect<Response, RouteFailure, never> {
    return routeEffect(() => auditRoutes.operations.getByLogId.invoke(ctx));
  }

}

export const AuditModule = defineModule({
  name: 'supauth-audit',
  tags: ['type:feature', 'scope:supauth-audit'],
  providers: [AuditPostExportAction],
  controllers: [AuditController],
});
