import { Elysia } from 'elysia';
import { createModulePlugin, type CompiledModule } from '@supacloud/elysia';
import { enforceStartupConfig, getConfig } from './config/index.js';
import { beginObservedRequest, mapObservedError, protectObservedResponse } from './middleware/index.js';
import { applyCorsHeaders, handleCorsPreflight } from './http/cors.js';
import { buildSupAuthOpenApi, swaggerHtml } from './http/documentation.js';
import { httpOperations } from './http/operations.js';
import type { HttpInvocation } from './http/operation.js';

export function createSupAuthHttpApplication(
  modules: readonly CompiledModule[],
  services: Record<string, Record<string, unknown>>,
): Pick<Elysia, 'handle' | 'routes'> & { readonly server: Elysia['server'] } {
  const config = getConfig();
  enforceStartupConfig(config);
  const application = new Elysia();
  const errorMapper = (error: unknown, context: { request: Request }): Response => {
    const failure = mapObservedError(context.request, error);
    return Response.json(failure.body, { status: failure.status });
  };
  application.error(({ request, error }) => errorMapper(error, { request }));

  for (const module of modules) {
    const owned = services[module.name];
    if (!owned) throw new Error(`Missing compiled services for ${module.name}`);
    // Elysia 1 的隐式 HEAD 语义：使用同一路由、权限与上下文，不重派发请求。
    const withHeadAliases: CompiledModule = {
      ...module,
      controllers: module.controllers.map(controller => ({
        ...controller,
        routes: controller.routes.flatMap(route =>
          route.method === 'GET' && !controller.routes.some(candidate =>
            candidate.method === 'HEAD' && candidate.path === route.path)
            ? [route, { ...route, method: 'HEAD' as const }]
            : [route]),
      })),
    };
    application.use(createModulePlugin(withHeadAliases, owned, (request, context): HttpInvocation => ({
      request,
      ...(context.params === undefined ? {} : { params: context.params }),
      ...(context.query === undefined ? {} : { query: context.query }),
      ...(context.headers === undefined ? {} : { headers: context.headers }),
    }), { errorMapper }, services));
  }
  const openApi = buildSupAuthOpenApi(httpOperations);
  application
    .get('/swagger', () => swaggerHtml())
    .get('/swagger/json', () => Response.json(openApi))
    .head('/swagger', () => new Response(null, { headers: swaggerHtml().headers }))
    .head('/swagger/json', () => new Response(null, { headers: { 'content-type': 'application/json' } }))
    .options('/', () => new Response(null, { status: 204 }))
    .options('/*', () => new Response(null, { status: 204 }));

  // 请求边界覆盖路由未匹配、解析错误和原生 Response，不依赖插件传播顺序。
  return {
    get routes() { return application.routes; },
    get server() { return application.server; },
    async handle(input, options) {
      const request = input instanceof Request ? input : new Request(input, options);
      beginObservedRequest(request);
      let response: Response;
      try {
        response = handleCorsPreflight(request, config.corsOrigins) ?? await application.handle(request);
      } catch (error) {
        response = errorMapper(error, { request });
      }
      return applyCorsHeaders(request, protectObservedResponse(request, response), config.corsOrigins);
    },
  };
}
