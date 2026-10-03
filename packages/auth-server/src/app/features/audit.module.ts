import { Controller, defineModule, Injectable, Get, Post } from '@supacloud/app';
import { auditRoutes } from '../../routes/audit.js';
import type { HttpInvocation } from '../../http/operation.js';
import { adminHttpAspect, requireAdminAction } from '../admin-aspect.js';

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
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/audit.ts#getRoot" },
    aspects: [adminHttpAspect],
  })
  getRoot(ctx: HttpInvocation): Promise<Response> {
    return auditRoutes.operations.getRoot.invoke(ctx);
  }

  @Post("/export", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/audit.ts#postExport" },
    aspects: [adminHttpAspect],
  })
  postExport(ctx: HttpInvocation): Promise<Response> {
    return auditRoutes.operations.postExport.invoke(ctx, context => this.postExportAction.execute(context));
  }

  @Get("/export", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/audit.ts#getExport" },
    aspects: [adminHttpAspect],
  })
  getExport(ctx: HttpInvocation): Promise<Response> {
    return auditRoutes.operations.getExport.invoke(ctx);
  }

  @Get("/export/:exportId/download", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/audit.ts#getExportByExportIdDownload" },
    aspects: [adminHttpAspect],
  })
  getExportByExportIdDownload(ctx: HttpInvocation): Promise<Response> {
    return auditRoutes.operations.getExportByExportIdDownload.invoke(ctx);
  }

  @Get("/export/:exportId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/audit.ts#getExportByExportId" },
    aspects: [adminHttpAspect],
  })
  getExportByExportId(ctx: HttpInvocation): Promise<Response> {
    return auditRoutes.operations.getExportByExportId.invoke(ctx);
  }

  @Get("/integrity", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/audit.ts#getIntegrity" },
    aspects: [adminHttpAspect],
  })
  getIntegrity(ctx: HttpInvocation): Promise<Response> {
    return auditRoutes.operations.getIntegrity.invoke(ctx);
  }

  @Get("/:logId", {
    parse: 'none',
    contract: { body: 'domain', response: 'native-json', evidence: "src/routes/audit.ts#getByLogId" },
    aspects: [adminHttpAspect],
  })
  getByLogId(ctx: HttpInvocation): Promise<Response> {
    return auditRoutes.operations.getByLogId.invoke(ctx);
  }

}

export const AuditModule = defineModule({
  name: 'supauth-audit',
  tags: ['type:feature', 'scope:supauth-audit'],
  providers: [AuditPostExportAction],
  controllers: [AuditController],
});
