import type { Static } from '../../../shared/src/schema.js';
import type { AdminPrincipalSchema } from '../../../shared/src/admin-auth-contracts.js';

export type AdminPrincipal = Static<typeof AdminPrincipalSchema>;

const RESOURCE_PERMISSIONS: Record<string, string> = {
  applications: 'applications',
  users: 'users',
  organizations: 'organizations',
  roles: 'roles',
  resources: 'api_resources',
  connectors: 'connectors',
  webhooks: 'webhooks',
  audit: 'audit',
  consents: 'consents',
  'security-config': 'security',
  'sign-in-experience': 'security',
  'auth-config': 'security',
  tenant: 'tenant.members',
  'tenant-config': 'tenant_config',
  'enterprise-sso': 'connectors',
  'org-templates': 'organizations',
  'auth-hooks': 'security',
  'account-provisioning': 'account_center',
  'my-account': 'account_center',
  passkeys: 'account_center',
  capabilities: 'tenant_config',
  compatibility: 'operations',
  'api-versions': 'operations',
  'admin-tools': 'operations',
  provisioning: 'operations',
  'rbac-bridge': 'operations',
  'route-gate': 'operations',
  sync: 'operations',
};

export function requiredAdminAction(method: string, pathname: string): string | null {
  if (!pathname.startsWith('/v1/')) return null;
  if ((method === 'GET' || method === 'POST') && (pathname === '/v1/audit/export' || pathname === '/v1/audit/export/')) return 'audit.export';
  if (method === 'GET' && /^\/v1\/audit\/export\/[^/]+(?:\/download)?$/.test(pathname)) return 'audit.export';
  if (method === 'GET' && /^\/v1\/audit\/(?!export(?:\/|$)|integrity\/?$)[^/]+\/?$/.test(pathname)) {
    return 'audit.read_sensitive';
  }
  if (method === 'POST' && /\/v1\/webhooks\/[^/]+\/deliveries\/[^/]+\/replay$/.test(pathname)) {
    return 'webhooks.replay';
  }
  if (!['GET', 'HEAD'].includes(method) && /^\/v1\/organizations\/[^/]+\/(?:members|invitations)(?:\/|$)/.test(pathname)) {
    return 'organizations.members.manage';
  }
  if (!['GET', 'HEAD'].includes(method) && /^\/v1\/organizations\/[^/]+\/(?:applications|branding|jit)(?:\/|$)/.test(pathname)) {
    return 'organizations.settings.manage';
  }

  const resource = pathname.split('/')[2];
  const permissionPrefix = RESOURCE_PERMISSIONS[resource ?? ''] || 'operations';
  return `${permissionPrefix}.${method === 'GET' || method === 'HEAD' ? 'read' : 'manage'}`;
}

export function principalHasAction(principal: AdminPrincipal, action: string): boolean {
  const granted = new Set(principal.permissions);
  if (granted.has('*') || granted.has(action)) return true;
  if (action.endsWith('.read') && granted.has(`${action.slice(0, -5)}.manage`)) return true;
  return false;
}
