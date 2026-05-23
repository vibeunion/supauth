// Organizations repository — backed by SupaCloud Postgres

import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { organizations, organizationMembers } from '../db/schema.js';

export async function listOrganizations() {
  const db = getDb();
  const orgs = await db.select().from(organizations).orderBy(organizations.createdAt);
  const members = await db.select().from(organizationMembers);
  return orgs.map(o => ({
    ...o,
    members: members.filter(m => m.organizationId === o.id),
  }));
}

export async function getOrganization(id: string) {
  const db = getDb();
  const org = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!org[0]) return null;
  const members = await db.select().from(organizationMembers).where(eq(organizationMembers.organizationId, id));
  return { ...org[0], members };
}

export async function createOrganization(data: { name: string; description?: string }) {
  const db = getDb();
  const [org] = await db.insert(organizations).values({
    name: data.name,
    description: data.description || null,
  }).returning();
  return { ...org, members: [] };
}

export async function updateOrganization(id: string, data: { name?: string; description?: string }) {
  const db = getDb();
  const [updated] = await db.update(organizations).set({
    ...data,
    updatedAt: new Date(),
  }).where(eq(organizations.id, id)).returning();
  return updated;
}

export async function deleteOrganization(id: string) {
  const db = getDb();
  await db.delete(organizations).where(eq(organizations.id, id));
}

export async function addMember(orgId: string, userId: string, role: string = 'member') {
  const db = getDb();
  const [member] = await db.insert(organizationMembers).values({
    organizationId: orgId,
    userId,
    role,
  }).returning();
  return member;
}

export async function removeMember(orgId: string, userId: string) {
  const db = getDb();
  await db.delete(organizationMembers).where(
    and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, userId))
  );
}

export async function updateMemberRole(orgId: string, userId: string, role: string) {
  const db = getDb();
  const [updated] = await db.update(organizationMembers).set({ role }).where(
    and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, userId))
  ).returning();
  return updated;
}
