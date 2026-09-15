import type { AdminIdentity, AdminSsoConfigSchema, Static } from '@supauth/shared';

export const disabledSsoConfig = {
  enabled: false, issuer: '', client_id: '', redirect_uri: 'http://localhost/admin',
  post_logout_redirect_uri: 'http://localhost/admin/login', end_session_endpoint: 'http://localhost/logout',
} satisfies Static<typeof AdminSsoConfigSchema>;

export const enabledSsoConfig = {
  enabled: true, issuer: 'https://issuer.example.test', client_id: 'admin-client',
  redirect_uri: 'https://admin.example.test/admin',
  post_logout_redirect_uri: 'https://admin.example.test/admin/login',
  end_session_endpoint: 'https://issuer.example.test/logout',
} satisfies Static<typeof AdminSsoConfigSchema>;

export const adminIdentityFixture = {
  id: 'admin-1', name: 'Admin', email: 'admin@example.test', avatar: null,
  roles: ['auditor'], permissions: ['audit.read', 'audit.export'],
  authorization_source: 'rbac_projection',
} satisfies AdminIdentity;

export function deferredRequest<T = void>() {
  let resolveRequest: (value: T | PromiseLike<T>) => void = () => {
    throw new Error('Request gate not initialized');
  };
  let rejectRequest: (reason: unknown) => void = () => {
    throw new Error('Request gate not initialized');
  };
  const promise = new Promise<T>((resolve, reject) => {
    resolveRequest = resolve;
    rejectRequest = reject;
  });
  return { promise, resolve: resolveRequest, reject: rejectRequest };
}

export async function runLockOperation(
  _name: string,
  optionsOrOperation: LockOptions | (() => unknown),
  operation?: () => unknown,
): Promise<unknown> {
  const callback = typeof optionsOrOperation === 'function' ? optionsOrOperation : operation;
  if (!callback) throw new Error('Expected lock callback');
  return callback();
}
