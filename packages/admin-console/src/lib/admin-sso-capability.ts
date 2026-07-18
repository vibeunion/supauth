type AuthenticatedFetchFactory = (fetcher?: typeof fetch) => typeof fetch;

export function requireAdminAuthenticatedFetch(provider: object): typeof fetch {
  const factory = (provider as { createAuthenticatedFetch?: AuthenticatedFetchFactory })
    .createAuthenticatedFetch;
  if (typeof factory !== 'function') {
    throw new Error(
      '当前 @svadmin/sso 版本不支持安全的 401 刷新重放；请升级到包含 createAuthenticatedFetch() 的版本。',
    );
  }
  return factory.call(provider);
}
