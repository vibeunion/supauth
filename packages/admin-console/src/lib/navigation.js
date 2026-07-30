// 这些浏览器路由只定义控制台信息架构，不能派生或替代 /api/v1 管理接口。
export const navigationSections = [
  {
    labelKey: 'nav.section.overview',
    entries: [
      { path: '/get-started', labelKey: 'nav.getStarted', icon: '✦' },
      { path: '/dashboard', labelKey: 'nav.dashboard', icon: '◉' },
    ],
  },
  {
    labelKey: 'nav.section.authentication',
    entries: [
      { path: '/applications', labelKey: 'nav.applications', icon: '⬡' },
      { path: '/sign-in-experience', labelKey: 'nav.signInExperience', icon: '◌' },
      { path: '/mfa', labelKey: 'nav.mfa', icon: '⌁' },
      { path: '/connectors', labelKey: 'nav.connectors', icon: '⊕' },
      { path: '/enterprise-sso', labelKey: 'nav.enterpriseSso', icon: '⇄' },
      { path: '/security', labelKey: 'nav.security', icon: '◇' },
    ],
  },
  {
    labelKey: 'nav.section.authorization',
    entries: [
      { path: '/api-resources', labelKey: 'nav.resources', icon: '◆' },
      { path: '/roles', labelKey: 'nav.roles', icon: '★' },
      { path: '/organization-template', labelKey: 'nav.orgTemplates', icon: '▦' },
    ],
  },
  {
    labelKey: 'nav.section.users',
    entries: [
      { path: '/organizations', labelKey: 'nav.organizations', icon: '⬢' },
      { path: '/users', labelKey: 'nav.users', icon: '⊙' },
    ],
  },
  {
    labelKey: 'nav.section.developer',
    entries: [
      { path: '/customize-jwt', labelKey: 'nav.customizeJwt', icon: '⌘' },
      { path: '/webhooks', labelKey: 'nav.webhooks', icon: '↗' },
      { path: '/audit-logs', labelKey: 'nav.audit', icon: '≡' },
    ],
  },
  {
    labelKey: 'nav.section.tenant',
    entries: [
      { path: '/tenant-settings', labelKey: 'nav.tenantSettings', icon: '⚙' },
    ],
  },
];

export function isNavigationEntryActive(currentPath, basePath, entryPath) {
  const canonicalPath = `${basePath}${entryPath}`.replace(/\/$/, '') || '/';
  const normalizedCurrentPath = currentPath.replace(/\/$/, '') || '/';
  return normalizedCurrentPath === canonicalPath || normalizedCurrentPath.startsWith(`${canonicalPath}/`);
}
