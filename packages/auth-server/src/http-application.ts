import { Elysia } from 'elysia';
import { createModulePlugin, type CompiledModule } from '@supacloud/elysia';
import { enforceStartupConfig, getConfig } from './config/index.js';
import { beginObservedRequest, mapObservedError, protectObservedResponse } from './middleware/index.js';
import { applyCorsHeaders, handleCorsPreflight } from './http/cors.js';
import { buildSupAuthOpenApi, swaggerHtml } from './http/documentation.js';
import { httpOperations } from './http/operations.js';
import type { HttpInvocation } from './http/operation.js';
import { isRecord } from './utils/api-contract.js';

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path.replace(/\/+/g, '/').replace(/\/+$/, '') || '/'}`;
}

export function createSupAuthHttpApplication(
  modules: readonly CompiledModule[],
  services: Record<string, Record<string, unknown>>,
): Pick<Elysia, 'handle' | 'routes'> & { readonly server: Elysia['server'] } {
  const config = getConfig();
  enforceStartupConfig(config);
  const application = new Elysia();
  const operationOptions = new Map(httpOperations.map(operation =>
    [routeKey(operation.method, operation.path), operation.options] as const));
  const headAliases = new Map<string, string>();
  const errorMapper = (error: unknown, context: { request: Request }): Response => {
    const failure = mapObservedError(context.request, error);
    return Response.json(failure.body, { status: failure.status });
  };
  application.onError(({ request, error }) => errorMapper(error, { request }));

  for (const module of modules) {
    const owned = services[module.name];
    if (!owned) throw new Error(`Missing compiled services for ${module.name}`);
    // Elysia 1 的隐式 HEAD 语义：使用同一路由、权限与上下文，不重派发请求。
    const withHeadAliases: CompiledModule = {
      ...module,
      controllers: module.controllers.map(controller => ({
        ...controller,
        routes: controller.routes.flatMap(route => {
          if (route.method !== 'GET' || controller.routes.some(candidate =>
            candidate.method === 'HEAD' && candidate.path === route.path)) return [route];
          const path = `${controller.path}/${route.path}`;
          headAliases.set(routeKey('HEAD', path), routeKey('GET', path));
          return [route, { ...route, method: 'HEAD' as const }];
        }),
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
  const swaggerDetail = Object.assign({ hide: true }, {
    'x-supauth-contract': { request: 'none', response: 'html', source: 'infra.swagger.ui' },
  });
  const swaggerJsonDetail = Object.assign({ hide: true }, {
    'x-supauth-contract': { request: 'none', response: 'protocol', source: 'infra.swagger.openapi' },
  });
  const swaggerHeadDetail = Object.assign({ hide: true }, {
    'x-supauth-contract': { request: 'none', response: 'empty', source: 'infra.swagger.ui' },
  });
  const swaggerJsonHeadDetail = Object.assign({ hide: true }, {
    'x-supauth-contract': { request: 'none', response: 'empty', source: 'infra.swagger.openapi' },
  });
  const corsDetail = Object.assign({ hide: true }, {
    'x-supauth-contract': { request: 'protocol', response: 'empty', source: 'infra.cors.preflight' },
  });
  application
    .get('/swagger', {
      detail: swaggerDetail,
    }, () => swaggerHtml())
    .get('/swagger/json', {
      detail: swaggerJsonDetail,
    }, () => Response.json(openApi))
    .head('/swagger', {
      detail: swaggerHeadDetail,
    }, () => new Response(null, { headers: swaggerHtml().headers }))
    .head('/swagger/json', {
      detail: swaggerJsonHeadDetail,
    }, () => new Response(null, { headers: { 'content-type': 'application/json' } }))
    .options('/', {
      detail: corsDetail,
    }, () => new Response(null, { status: 204 }))
    .options('/*', {
      detail: corsDetail,
    }, () => new Response(null, { status: 204 }));

  // 请求边界覆盖路由未匹配、解析错误和原生 Response，不依赖插件传播顺序。
  return {
    get routes() {
      // Elysia 2 返回钩子快照；每次读取关联真实领域合同，校验仍由 invoke 执行。
      return application.routes.map(route => {
        const key = routeKey(route.method, route.path);
        const headSource = headAliases.get(key);
        const operation = operationOptions.get(headSource ?? key);
        if (!operation) return route;
        const detail: Record<string, unknown> = { ...route.hooks.detail, ...operation.detail };
        if (headSource) {
          detail['hide'] = true;
          const contract = detail['x-supauth-contract'];
          if (isRecord(contract)) detail['x-supauth-contract'] = { ...contract, response: 'empty' };
          const responses = detail['responses'];
          if (isRecord(responses)) detail['responses'] = Object.fromEntries(
            Object.entries(responses).map(([status, response]) => {
              if (!isRecord(response)) return [status, response];
              const emptyResponse = { ...response };
              delete emptyResponse['content'];
              delete emptyResponse['x-supauth-response-alternatives'];
              return [status, emptyResponse];
            }),
          );
        }
        return {
          ...route,
          hooks: {
            ...route.hooks,
            ...(operation.body === undefined ? {} : { body: operation.body }),
            detail,
          },
        };
      });
    },
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
