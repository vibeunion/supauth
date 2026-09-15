import type { AdminFetch } from './admin-api.js';
import { isUnknownFunction } from './unknown-value.js';

export function requireAdminAuthenticatedFetch(provider: object): AdminFetch {
  const factory = 'createAuthenticatedFetch' in provider ? provider.createAuthenticatedFetch : undefined;
  if (!isUnknownFunction(factory)) {
    throw new Error(
      '当前 @svadmin/sso 版本不支持安全的 401 刷新重放；请升级到包含 createAuthenticatedFetch() 的版本。',
    );
  }
  const fetcher = factory.call(provider);
  if (!isUnknownFunction(fetcher)) throw new TypeError('createAuthenticatedFetch must return a callable fetch');
  return async (input, init) => {
    const response = await fetcher(input, init);
    if (!(response instanceof Response)) throw new TypeError('Authenticated fetch must return a Response');
    return response;
  };
}
