export const ADMIN_SSO_REQUIRE_AAL2_ERROR = 'ADMIN_SSO_REQUIRE_AAL2 must be true or false when configured';

/**
 * 管理员 MFA 仅接受显式 true 开启。遗漏、空值或 false 保持兼容模式；其他值
 * 必须被拒绝，避免拼写错误意外关闭安全门禁。
 */
export function parseAdminSsoRequireAal2(value?: string): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'false') return false;
  if (normalized === 'true') return true;
  throw new Error(ADMIN_SSO_REQUIRE_AAL2_ERROR);
}
