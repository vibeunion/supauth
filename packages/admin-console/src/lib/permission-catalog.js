export const PERMISSION_GROUPS = [
  'resource',
  'organization',
  'users',
  'applications',
  'connectors',
  'api_resources',
  'consents',
  'webhooks',
  'account_center',
  'tenant_config',
  'security',
  'operations',
  'audit',
];

export const PERMISSION_CATALOG = [
  { name: 'resource.read', group: 'resource', labelKey: 'perm.resource.read.label', descKey: 'perm.resource.read.desc' },
  { name: 'resource.write', group: 'resource', labelKey: 'perm.resource.write.label', descKey: 'perm.resource.write.desc' },
  { name: 'organization.manage', group: 'organization', labelKey: 'perm.organization.manage.label', descKey: 'perm.organization.manage.desc' },
  { name: 'organization.members.manage', group: 'organization', labelKey: 'perm.organization.members.manage.label', descKey: 'perm.organization.members.manage.desc' },
  { name: 'organization.settings.manage', group: 'organization', labelKey: 'perm.organization.settings.manage.label', descKey: 'perm.organization.settings.manage.desc' },
  { name: 'users.read', group: 'users', labelKey: 'perm.users.read.label', descKey: 'perm.users.read.desc' },
  { name: 'users.write', group: 'users', labelKey: 'perm.users.write.label', descKey: 'perm.users.write.desc' },
  { name: 'users.manage', group: 'users', labelKey: 'perm.users.manage.label', descKey: 'perm.users.manage.desc' },
  { name: 'applications.read', group: 'applications', labelKey: 'perm.applications.read.label', descKey: 'perm.applications.read.desc' },
  { name: 'applications.manage', group: 'applications', labelKey: 'perm.applications.manage.label', descKey: 'perm.applications.manage.desc' },
  { name: 'connectors.read', group: 'connectors', labelKey: 'perm.connectors.read.label', descKey: 'perm.connectors.read.desc' },
  { name: 'connectors.manage', group: 'connectors', labelKey: 'perm.connectors.manage.label', descKey: 'perm.connectors.manage.desc' },
  { name: 'api_resources.read', group: 'api_resources', labelKey: 'perm.api_resources.read.label', descKey: 'perm.api_resources.read.desc' },
  { name: 'api_resources.manage', group: 'api_resources', labelKey: 'perm.api_resources.manage.label', descKey: 'perm.api_resources.manage.desc' },
  { name: 'consents.read', group: 'consents', labelKey: 'perm.consents.read.label', descKey: 'perm.consents.read.desc' },
  { name: 'consents.manage', group: 'consents', labelKey: 'perm.consents.manage.label', descKey: 'perm.consents.manage.desc' },
  { name: 'webhooks.read', group: 'webhooks', labelKey: 'perm.webhooks.read.label', descKey: 'perm.webhooks.read.desc' },
  { name: 'webhooks.manage', group: 'webhooks', labelKey: 'perm.webhooks.manage.label', descKey: 'perm.webhooks.manage.desc' },
  { name: 'account_center.read', group: 'account_center', labelKey: 'perm.account_center.read.label', descKey: 'perm.account_center.read.desc' },
  { name: 'account_center.manage', group: 'account_center', labelKey: 'perm.account_center.manage.label', descKey: 'perm.account_center.manage.desc' },
  { name: 'tenant_config.read', group: 'tenant_config', labelKey: 'perm.tenant_config.read.label', descKey: 'perm.tenant_config.read.desc' },
  { name: 'tenant_config.manage', group: 'tenant_config', labelKey: 'perm.tenant_config.manage.label', descKey: 'perm.tenant_config.manage.desc' },
  { name: 'security.read', group: 'security', labelKey: 'perm.security.read.label', descKey: 'perm.security.read.desc' },
  { name: 'security.manage', group: 'security', labelKey: 'perm.security.manage.label', descKey: 'perm.security.manage.desc' },
  { name: 'operations.read', group: 'operations', labelKey: 'perm.operations.read.label', descKey: 'perm.operations.read.desc' },
  { name: 'operations.manage', group: 'operations', labelKey: 'perm.operations.manage.label', descKey: 'perm.operations.manage.desc' },
  { name: 'audit.read', group: 'audit', labelKey: 'perm.audit.read.label', descKey: 'perm.audit.read.desc' },
];

const CATALOG_BY_NAME = Object.fromEntries(PERMISSION_CATALOG.map((permission) => [permission.name, permission]));

export function permissionMeta(name) {
  if (!name) return null;
  if (CATALOG_BY_NAME[name]) return CATALOG_BY_NAME[name];
  const prefix = name.includes('.') ? name.slice(0, name.indexOf('.')) : 'custom';
  return { name, group: PERMISSION_GROUPS.includes(prefix) ? prefix : 'custom', labelKey: null, descKey: null };
}

export function permissionLabel(perm, t) {
  const meta = permissionMeta(perm.name);
  if (meta?.labelKey) return t(meta.labelKey);
  if (perm.description) return perm.description;
  return perm.name;
}

export function permissionDescription(perm, t) {
  const meta = permissionMeta(perm.name);
  if (meta?.descKey) return t(meta.descKey);
  if (perm.description) return perm.description;
  return '';
}
