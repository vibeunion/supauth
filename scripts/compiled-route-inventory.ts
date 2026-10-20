import { openApiPath, type DocumentedOperation } from '../packages/auth-server/src/http/documentation.js';
import { createRouteContractInventory, type RouteContractInventory } from './type-safety-contract.js';
import { requireRecord } from './tooling-values.js';

interface RuntimeRoute {
  readonly method: string;
  readonly path: string;
}

const infrastructure = [
  { method: 'GET', path: '/swagger', request: 'none', response: 'html', source: 'infra.swagger.ui' },
  { method: 'GET', path: '/swagger/json', request: 'none', response: 'protocol', source: 'infra.swagger.openapi' },
  { method: 'HEAD', path: '/swagger', request: 'none', response: 'empty', source: 'infra.swagger.ui' },
  { method: 'HEAD', path: '/swagger/json', request: 'none', response: 'empty', source: 'infra.swagger.openapi' },
  { method: 'OPTIONS', path: '/', request: 'protocol', response: 'empty', source: 'infra.cors.preflight' },
  { method: 'OPTIONS', path: '/*', request: 'protocol', response: 'empty', source: 'infra.cors.preflight' },
] as const;

function key(route: RuntimeRoute): string {
  // Compiled 路由规整尾斜杠；参数名必须仍与领域声明完全一致。
  return `${route.method.toUpperCase()} ${route.path.replace(/\/+$/, '') || '/'}`;
}

function headInventory(route: RuntimeRoute, source: RouteContractInventory): RouteContractInventory {
  // 派生 HEAD 不复用 GET 的可选 operationId，避免文档标识冲突。
  const { operationId: _operationId, ...operation } = requireRecord(source.operation, 'HEAD source operation');
  const contract = source.contract === undefined ? undefined : {
    ...requireRecord(source.contract, 'HEAD source contract'),
    response: 'empty',
  };
  const responses = operation['responses'] === undefined ? undefined : Object.fromEntries(
    Object.entries(requireRecord(operation['responses'], 'HEAD source responses')).map(([status, value]) => {
      const declared = requireRecord(value, 'HEAD source response');
      // 引用可能携带响应体；未解析前不能将它标成 empty。
      if (Object.hasOwn(declared, '$ref')) {
        throw new Error(`Referenced HEAD source response is unsupported: ${key(route)} ${status}`);
      }
      const { content: _content, 'x-supauth-response-alternatives': _alternatives, ...response } =
        declared;
      return [status, response];
    }),
  );
  const bindings = operation['x-supauth-bindings'] === undefined ? undefined :
    requireRecord(operation['x-supauth-bindings'], 'HEAD source bindings');
  const { response: _response, ...inputBindings } = bindings ?? {};
  return {
    method: route.method,
    path: route.path,
    hidden: source.hidden,
    ...(contract === undefined ? {} : { contract }),
    operation: {
      ...operation,
      ...(contract === undefined ? {} : { 'x-supauth-contract': contract }),
      ...(responses === undefined ? {} : { responses }),
      ...(bindings === undefined ? {} : { 'x-supauth-bindings': inputBindings }),
      'x-supauth-head-source': { method: source.method, path: source.path },
    },
  };
}

/** Router 决定完整分母；领域声明提供契约。任一关联缺失或歧义都阻止导出。 */
export function createCompiledRouteContractInventory(
  routes: readonly RuntimeRoute[],
  operations: readonly DocumentedOperation[],
): RouteContractInventory[] {
  const runtime = new Map<string, RuntimeRoute>();
  for (const route of routes) {
    if (runtime.has(key(route))) throw new Error(`Duplicate runtime route: ${key(route)}`);
    runtime.set(key(route), route);
  }
  const declarations = new Map<string, DocumentedOperation>();
  const protocols = new Map(infrastructure.map(route => [key(route), route]));
  for (const operation of operations) {
    const id = key(operation);
    if (declarations.has(id) || protocols.has(id)) throw new Error(`Ambiguous domain operation: ${id}`);
    if (!runtime.has(id)) throw new Error(`missing_operation: Domain operation has no runtime route: ${id}`);
    declarations.set(id, operation);
  }

  return routes.map(route => {
    const id = key(route);
    const declared = declarations.get(id);
    if (declared) return createRouteContractInventory({ ...route, hooks: declared.options });
    const protocol = protocols.get(id);
    if (protocol) {
      const { request, response, source } = protocol;
      return createRouteContractInventory({
        ...route,
        hooks: { detail: { hide: true, 'x-supauth-contract': { request, response, source } } },
      });
    }
    if (route.method.toUpperCase() === 'HEAD') {
      const getKey = key({ method: 'GET', path: route.path });
      const get = declarations.get(getKey);
      if (get && runtime.has(getKey)) {
        return headInventory(route, createRouteContractInventory({ ...get, hooks: get.options }));
      }
    }
    // 不信任 router 或文档中的兜底标记，也不静默跳过新增路由。
    throw new Error(`missing_contract: Runtime route has no domain operation: ${id}`);
  });
}

/** 可见 HEAD 也进入导出文档；沿用真实 GET 的状态及输入声明，不伪造成功 schema。 */
export function includeRuntimeHeadOperations(
  specification: Record<string, unknown>,
  inventory: readonly RouteContractInventory[],
): Record<string, unknown> {
  const paths = { ...requireRecord(specification['paths'], 'OpenAPI paths') };
  for (const route of inventory) {
    if (route.method.toUpperCase() !== 'HEAD' || route.hidden) continue;
    const operation = requireRecord(route.operation, 'HEAD inventory operation');
    if (operation['x-supauth-head-source'] === undefined) continue;
    const path = openApiPath(route.path);
    const item = paths[path] === undefined ? {} : requireRecord(paths[path], 'OpenAPI path item');
    if (item['head'] !== undefined) throw new Error(`Duplicate HEAD documentation: ${path}`);
    paths[path] = { ...item, head: operation };
  }
  return { ...specification, paths };
}
