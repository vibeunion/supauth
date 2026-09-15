type FetchHandler = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** 保留 mock 的调用记录，同时提供 Bun fetch 所需的静态方法，禁止意外真实预连接。 */
export function strictFetch<T extends FetchHandler>(handler: T) {
  return Object.assign(handler, {
    preconnect() {
      throw new Error('Unexpected network preconnect in a test transport');
    },
  }) satisfies typeof fetch;
}
