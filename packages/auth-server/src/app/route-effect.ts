import { Effect } from 'effect';

/** 路由层统一失败类型；tag 必须与路由 effect.errors 声明一致。 */
export type RouteFailure = {
  readonly _tag: 'RouteFailure';
  readonly status: number;
  readonly code: string;
  readonly message: string;
};

/**
 * 把现有 Promise 路由处理函数提升为受 Effect 门禁约束的程序。
 * Elysia 边界负责执行 Effect；处理器内部继续复用既有业务逻辑。
 */
export function routeEffect(
  run: () => Promise<Response>,
): Effect.Effect<Response, RouteFailure, never> {
  return Effect.tryPromise({
    try: run,
    catch: (): RouteFailure => ({
      _tag: 'RouteFailure',
      status: 500,
      code: 'internal_error',
      message: 'Internal server error',
    }),
  });
}