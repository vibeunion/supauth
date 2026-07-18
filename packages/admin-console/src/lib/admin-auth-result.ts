import type { CheckResult } from '@svadmin/core';

function errorRecord(error: unknown): Record<string, unknown> | null {
  return typeof error === 'object' && error !== null
    ? error as Record<string, unknown>
    : null;
}

export function adminCheckFailure(error: unknown): CheckResult {
  const record = errorRecord(error);
  const status = typeof record?.statusCode === 'number'
    ? record.statusCode
    : typeof record?.status === 'number'
      ? record.status
      : null;

  if (status === 401) {
    return { authenticated: false, redirectTo: '/admin/login', logout: true };
  }

  const message = error instanceof Error && error.message
    ? error.message
    : status === 403
      ? '当前账号没有访问管理控制台的权限。'
      : '认证服务暂时不可用，请稍后重试。';
  return { authenticated: false, error: { message } };
}
