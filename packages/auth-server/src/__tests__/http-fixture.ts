import { Elysia } from 'elysia';
import type { HttpInvocation, HttpOperationOptions } from '../http/operation.js';

interface TestOperation {
  readonly method: string;
  readonly path: string;
  readonly options: Pick<HttpOperationOptions, 'detail'>;
  invoke(input: HttpInvocation): Promise<Response>;
}

interface TestOperationGroup {
  readonly prefix: string;
  readonly operations: Readonly<Record<string, TestOperation>> | readonly TestOperation[];
}

/** 仅用于业务操作的单元测试；生产路由仍由 compiled runtime 注册。 */
export function operationTestPlugin(input: TestOperationGroup | readonly TestOperationGroup[]) {
  const app = new Elysia();
  const groups = 'prefix' in input ? [input] : input;
  for (const group of groups) {
    for (const operation of Object.values(group.operations)) {
      app.method(operation.method, `${group.prefix}${operation.path}`, {
        parse: 'none',
        ...(operation.options.detail === undefined ? {} : { detail: operation.options.detail }),
      }, ({ request, params, query }) => operation.invoke({ request, params, query }));
    }
  }
  return app;
}
