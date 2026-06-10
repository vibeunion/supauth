// Roles and Permissions repository compatibility facade.
//
// SupaCloud owns RBAC source-of-truth. Keep these exports for older internal
// callers/tests, but never write the legacy supaoauth.roles/permissions tables.

import { getSupaCloudAdapter } from '../supacloud/adapter.js';

// ─── Roles ─────────────────────────────────────────────────────────────

export async function listRoles() {
  return getSupaCloudAdapter().listRoles();
}

export async function getRole(id: string) {
  return getSupaCloudAdapter().getRole(id);
}

export async function createRole(data: { name: string; description?: string }) {
  return getSupaCloudAdapter().createRole(data);
}

export async function updateRole(id: string, data: { name?: string; description?: string }) {
  return getSupaCloudAdapter().updateRole(id, data);
}

export async function deleteRole(id: string) {
  return getSupaCloudAdapter().deleteRole(id);
}

// ─── Permissions ───────────────────────────────────────────────────────

export async function createPermission(data: {
  name: string;
  description?: string;
  roleId: string;
  scopeId?: string;
}) {
  return getSupaCloudAdapter().createPermission(data.roleId, {
    name: data.name,
    description: data.description || null,
    scopeId: data.scopeId || null,
  });
}

export async function deletePermission(id: string, roleId?: string) {
  if (!roleId) {
    throw new Error('roleId is required to delete a SupaCloud-managed permission');
  }
  return getSupaCloudAdapter().deletePermission(roleId, id);
}

export async function listRolePermissions(roleId: string) {
  return getSupaCloudAdapter().listRolePermissions(roleId);
}

// ─── Role Assignments ──────────────────────────────────────────────────

export async function assignRole(data: {
  roleId: string;
  userId?: string;
  organizationId?: string;
  applicationId?: string;
}) {
  if (!data.userId && !data.applicationId) {
    throw new Error('Either userId or applicationId is required for role assignment');
  }
  return getSupaCloudAdapter().assignRole(data.roleId, {
    userId: data.userId || null,
    organizationId: data.organizationId || null,
    applicationId: data.applicationId || null,
  });
}

export async function revokeRole(assignmentId: string, roleId?: string) {
  if (!roleId) {
    throw new Error('roleId is required to revoke a SupaCloud-managed role assignment');
  }
  return getSupaCloudAdapter().revokeRole(roleId, assignmentId);
}

/** Get all role assignments for a user */
export async function getUserRoleAssignments(userId: string) {
  return getSupaCloudAdapter().getUserRoleAssignments(userId);
}

/** Get all role assignments for an organization */
export async function getOrgRoleAssignments(orgId: string) {
  return getSupaCloudAdapter().getOrgRoleAssignments(orgId);
}

/** Resolve effective permissions for a user (optionally in org context) */
export async function resolveUserPermissions(userId: string, orgId?: string) {
  return getSupaCloudAdapter().resolveUserPermissions(userId, orgId);
}
