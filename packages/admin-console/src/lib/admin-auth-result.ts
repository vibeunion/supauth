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
  const code = typeof record?.code === 'string' ? record.code : null;

  if (status === 401) {
    return { authenticated: false, redirectTo: '/admin/login', logout: true };
  }

  if (status === 403 && code === 'admin_mfa_required') {
    return {
      authenticated: false,
      error: {
        message: '管理员必须完成双因素认证。请在管理后台的 MFA 绑定页面完成 GoTrue TOTP 验证。',
        name: 'admin_mfa_required',
      },
    };
  }

  const message = error instanceof Error && error.message
    ? error.message
    : status === 403
      ? '当前账号没有访问管理控制台的权限。'
      : '认证服务暂时不可用，请稍后重试。';
  return { authenticated: false, error: { message } };
}
