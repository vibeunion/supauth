import {
  createPermissionAccessControlProvider,
  resetAccessControlProvider,
  setAccessControlProvider,
} from '@svadmin/core';
import type { AuthProvider, PermissionCatalog } from '@svadmin/core';
import { PERMISSION_CATALOG } from '../permission-catalog.js';

export const ADMIN_PERMISSION_APPLICATION_ID = 'supaoauth-admin-console';
export const ADMIN_PERMISSION_CATALOG_VERSION = '1';

const ACTIONS_BY_BACKEND_ACTION: Readonly<Record<string, readonly string[]>> = Object.freeze({
  read: ['list', 'show'],
  write: ['create', 'edit'],
  manage: ['list', 'show', 'create', 'edit', 'delete'],
  export: ['export'],
  replay: ['replay'],
  read_sensitive: ['field'],
});

function projectPermission(value: string): readonly string[] {
  const canonical = canonicalPermission(value);
  const separator = canonical.lastIndexOf(':');
  const resource = canonical.slice(0, separator);
  const action = canonical.slice(separator + 1);
  const actions = ACTIONS_BY_BACKEND_ACTION[action];
  return actions === undefined ? [canonical] : actions.map((entry) => `${resource}:${entry}`);
}

const ADMIN_PERMISSION_NAMES = Object.freeze(
  PERMISSION_CATALOG.flatMap(({ name }) => projectPermission(name)),
);

const ADMIN_PERMISSION_CATALOG: PermissionCatalog = Object.freeze({
  applicationId: ADMIN_PERMISSION_APPLICATION_ID,
  version: ADMIN_PERMISSION_CATALOG_VERSION,
  permissions: ADMIN_PERMISSION_NAMES,
});

function canonicalPermission(value: string): string {
  const trimmed = value.trim();
  if (/^[a-z][a-z0-9._-]*:[a-z][a-z0-9._-]*$/.test(trimmed)) return trimmed;
  const separator = trimmed.lastIndexOf('.');
  if (separator <= 0 || separator === trimmed.length - 1) {
    throw new TypeError(`Invalid admin permission: ${value}`);
  }
  const resource = trimmed.slice(0, separator);
  const action = trimmed.slice(separator + 1);
  if (!/^[a-z][a-z0-9._-]*$/.test(resource) || !/^[a-z][a-z0-9._-]*$/.test(action)) {
    throw new TypeError(`Invalid admin permission: ${value}`);
  }
  return `${resource}:${action}`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((entry: unknown): entry is string => typeof entry === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function permissionValues(value: unknown): readonly string[] {
  if (!isStringArray(value)) {
    throw new TypeError('Admin permission snapshot must contain a string array');
  }
  const expanded = value.includes('*')
    ? ADMIN_PERMISSION_NAMES
    : value.flatMap(projectPermission);
  return Object.freeze([...new Set(expanded)]);
}

export function createAdminPermissionSnapshot(value: unknown) {
  if (!isRecord(value)) {
    throw new TypeError('Admin permission response must be an object');
  }
  const permissions = value['permissions'];
  return {
    applicationId: ADMIN_PERMISSION_APPLICATION_ID,
    catalogVersion: ADMIN_PERMISSION_CATALOG_VERSION,
    permissions: permissionValues(permissions),
  } as const;
}

export async function registerAdminAccessControl(provider: Pick<AuthProvider, 'getPermissions'>): Promise<void> {
  const permissions = await provider.getPermissions?.();
  if (permissions === undefined || permissions === null) {
    resetAccessControlProvider();
    return;
  }
  const snapshot = createAdminPermissionSnapshot(permissions);
  setAccessControlProvider(createPermissionAccessControlProvider(snapshot, {
    buttons: { enableAccessControl: true, hideIfUnauthorized: false },
    catalog: ADMIN_PERMISSION_CATALOG,
  }));
}

export function resetAdminAccessControl(): void {
  resetAccessControlProvider();
}
