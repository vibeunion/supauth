// Roles and Permissions repository — backed by SupaCloud Postgres

import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { roles, permissions, roleAssignments } from '../db/schema.js';

// ─── Roles ─────────────────────────────────────────────────────────────

export async function listRoles() {
  const db = getDb();
  const allRoles = await db.select().from(roles).orderBy(roles.createdAt);
  const allPermissions = await db.select().from(permissions);
  return allRoles.map(r => ({
    ...r,
    permissions: allPermissions.filter(p => p.roleId === r.id),
  }));
}

export async function getRole(id: string) {
  const db = getDb();
  const rows = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  if (!rows[0]) return null;
  const rolePerms = await db.select().from(permissions).where(eq(permissions.roleId, id));
  return { ...rows[0], permissions: rolePerms };
}

export async function createRole(data: { name: string; description?: string }) {
  const db = getDb();
  const [role] = await db.insert(roles).values({
    name: data.name,
    description: data.description || null,
  }).returning();
  return { ...role, permissions: [] };
}

export async function updateRole(id: string, data: { name?: string; description?: string }) {
  const db = getDb();
  const [updated] = await db.update(roles).set(data).where(eq(roles.id, id)).returning();
  return updated;
}

export async function deleteRole(id: string) {
  const db = getDb();
  await db.delete(roles).where(eq(roles.id, id));
}

// ─── Permissions ───────────────────────────────────────────────────────

export async function createPermission(data: {
  name: string;
  description?: string;
  roleId: string;
  scopeId?: string;
}) {
  const db = getDb();
  const [perm] = await db.insert(permissions).values({
    name: data.name,
    description: data.description || null,
    roleId: data.roleId,
    scopeId: data.scopeId || null,
  }).returning();
  return perm;
}

export async function deletePermission(id: string) {
  const db = getDb();
  await db.delete(permissions).where(eq(permissions.id, id));
}

export async function listRolePermissions(roleId: string) {
  const db = getDb();
  return db.select().from(permissions).where(eq(permissions.roleId, roleId));
}

// ─── Role Assignments ──────────────────────────────────────────────────

export async function assignRole(data: {
  roleId: string;
  userId: string;
  organizationId?: string;
  applicationId?: string;
}) {
  const db = getDb();
  const [assignment] = await db.insert(roleAssignments).values({
    roleId: data.roleId,
    userId: data.userId,
    organizationId: data.organizationId || null,
    applicationId: data.applicationId || null,
  }).returning();
  return assignment;
}

export async function revokeRole(assignmentId: string) {
  const db = getDb();
  await db.delete(roleAssignments).where(eq(roleAssignments.id, assignmentId));
}

/** Get all role assignments for a user */
export async function getUserRoleAssignments(userId: string) {
  const db = getDb();
  const assignments = await db.select().from(roleAssignments)
    .where(eq(roleAssignments.userId, userId));
  // Enrich with role info
  const allRoles = await db.select().from(roles);
  return assignments.map(a => {
    const role = allRoles.find(r => r.id === a.roleId);
    return { ...a, role: role || null };
  });
}

/** Get all role assignments for an organization */
export async function getOrgRoleAssignments(orgId: string) {
  const db = getDb();
  const assignments = await db.select().from(roleAssignments)
    .where(eq(roleAssignments.organizationId, orgId));
  const allRoles = await db.select().from(roles);
  return assignments.map(a => {
    const role = allRoles.find(r => r.id === a.roleId);
    return { ...a, role: role || null };
  });
}

/** Resolve effective permissions for a user (optionally in org context) */
export async function resolveUserPermissions(userId: string, orgId?: string) {
  const db = getDb();
  const assignments = await db.select().from(roleAssignments)
    .where(eq(roleAssignments.userId, userId));

  // Filter to user-level and matching org-level
  const relevant = assignments.filter(a =>
    !a.organizationId || (orgId && a.organizationId === orgId)
  );

  // Collect all role IDs
  const roleIds = [...new Set(relevant.map(a => a.roleId))];
  if (roleIds.length === 0) return { roles: [], permissions: [] };

  // Fetch roles with permissions
  const allRoles = await db.select().from(roles);
  const allPermissions = await db.select().from(permissions);
  const matchedRoles = allRoles.filter(r => roleIds.includes(r.id));
  const matchedPerms = allPermissions.filter(p => roleIds.includes(p.roleId));

  return { roles: matchedRoles, permissions: matchedPerms };
}
