import {
  initializeApplication,
  type CompiledModule,
} from '../generated/application.js';

export function createCompiledRuntime(
  modules: readonly CompiledModule[],
  options: { deps?: Record<string, unknown> } = {},
) {
  const names = new Set<string>();
  for (const module of modules) {
    if (names.has(module.name)) {
      throw new Error(`Duplicate compiled module: ${module.name}`);
    }
    names.add(module.name);
  }

  const servicesByModule: Record<string, Record<string, unknown>> = {};
  Object.setPrototypeOf(servicesByModule, null);
  const created: { module: CompiledModule; services: Record<string, unknown> }[] = [];
  let creationFailure: { error: unknown } | undefined;
  try {
    for (const module of modules) {
      const owned = module.createServices(options.deps ?? {}, servicesByModule);
      servicesByModule[module.name] = owned;
      created.push({ module, services: owned });
    }
  } catch (error) {
    creationFailure = { error };
  }

  let closed = false;
  let destruction: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  const inFlight = new Set<Promise<unknown>>();

  function destroyOnce(): Promise<void> {
    closed = true;
    destruction ??= Promise.resolve().then(async () => {
      const errors: unknown[] = [];
      for (const entry of [...created].reverse()) {
        try {
          await entry.module.destroyServices?.(entry.services);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, 'Compiled module cleanup failed');
      }
    });
    return destruction;
  }

  const ready = Promise.resolve().then(async () => {
    try {
      if (creationFailure) throw creationFailure.error;
      for (const entry of created) {
        await entry.module.initializeServices?.(entry.services);
      }
      // 生成的模块初始化只调用服务钩子；平台初始器需单独执行。
      for (const entry of created) {
        await initializeApplication(entry.services);
      }
    } catch (error) {
      try {
        await destroyOnce();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Compiled runtime initialization and cleanup failed',
          { cause: error },
        );
      }
      throw error;
    }
  });

  // 保留 ready 的拒绝结果，同时允许宿主稍后才接入生命周期。
  void ready.catch(() => {});

  async function run<T>(work: () => T | Promise<T>): Promise<T> {
    if (closed) throw new Error('SupAuth runtime is closed');
    await ready;
    if (closed) throw new Error('SupAuth runtime is closed');

    // 先登记再执行，确保同步回调内触发 close 时也能等待该请求。
    const pending = Promise.resolve().then(work);
    inFlight.add(pending);
    try {
      return await pending;
    } finally {
      inFlight.delete(pending);
    }
  }

  async function drainAndDestroy(): Promise<void> {
    await Promise.allSettled([...inFlight]);
    await destroyOnce();
  }

  function close(): Promise<void> {
    closed = true;
    closing ??= ready.then(drainAndDestroy, drainAndDestroy);
    return closing;
  }

  async function resolve<T>(
    selector: (servicesByModule: Record<string, Record<string, unknown>>) => T,
  ): Promise<T> {
    // ready 已负责初始化失败的回滚；这里只处理服务选择失败。
    await ready;
    try {
      if (closed) throw new Error('SupAuth runtime is closed');
      return selector(servicesByModule);
    } catch (error) {
      try {
        await close();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Compiled service resolution and cleanup failed',
          { cause: error },
        );
      }
      throw error;
    }
  }

  return {
    servicesByModule,
    ready,
    resolve,
    run,
    close,
    get creationError(): unknown {
      return creationFailure?.error;
    },
    get closed() {
      return closed;
    },
  };
}
