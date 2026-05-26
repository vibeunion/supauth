// Organization template repository (P0-18) — backed by SupaCloud Postgres

import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { organizationTemplates, roles, permissions, organizationMembers } from '../db/schema.js';
import * as orgRepo from './organizations.js';
import * as roleRepo from './roles.js';

export interface OrgTemplate {
  id: string;
  name: string;
  description: string | null;
  templateRoles: Array<{ name: string; permissions: string[] }>;
  templateScopes: Array<{ name: string; description?: string }>;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** List all organization templates */
export async function listTemplates() {
  const db = getDb();
  return db.select().from(organizationTemplates).orderBy(organizationTemplates.createdAt);
}

/** Get a template by ID */
export async function getTemplate(id: string) {
  const db = getDb();
  const rows = await db.select().from(organizationTemplates)
    .where(eq(organizationTemplates.id, id)).limit(1);
  return rows[0] || null;
}

/** Get the default template */
export async function getDefaultTemplate() {
  const db = getDb();
  const rows = await db.select().from(organizationTemplates)
    .where(eq(organizationTemplates.isDefault, true)).limit(1);
  return rows[0] || null;
}

/** Create an organization template */
export async function createTemplate(data: {
  name: string;
  description?: string;
  templateRoles?: Array<{ name: string; permissions: string[] }>;
  templateScopes?: Array<{ name: string; description?: string }>;
  isDefault?: boolean;
}) {
  const db = getDb();

  // If setting as default, unset any existing default
  if (data.isDefault) {
    const existing = await db.select().from(organizationTemplates)
      .where(eq(organizationTemplates.isDefault, true));
    for (const t of existing) {
      await db.update(organizationTemplates).set({ isDefault: false, updatedAt: new Date() })
        .where(eq(organizationTemplates.id, t.id));
    }
  }

  const [template] = await db.insert(organizationTemplates).values({
    name: data.name,
    description: data.description || null,
    templateRoles: data.templateRoles || [],
    templateScopes: data.templateScopes || [],
    isDefault: data.isDefault ?? false,
  }).returning();
  return template;
}

/** Update a template */
export async function updateTemplate(id: string, data: {
  name?: string;
  description?: string;
  templateRoles?: Array<{ name: string; permissions: string[] }>;
  templateScopes?: Array<{ name: string; description?: string }>;
  isDefault?: boolean;
}) {
  const db = getDb();

  if (data.isDefault) {
    const existing = await db.select().from(organizationTemplates)
      .where(eq(organizationTemplates.isDefault, true));
    for (const t of existing) {
      if (t.id !== id) {
        await db.update(organizationTemplates).set({ isDefault: false, updatedAt: new Date() })
          .where(eq(organizationTemplates.id, t.id));
      }
    }
  }

  const [updated] = await db.update(organizationTemplates).set({
    ...data,
    updatedAt: new Date(),
  }).where(eq(organizationTemplates.id, id)).returning();
  return updated;
}

/** Delete a template */
export async function deleteTemplate(id: string) {
  const db = getDb();
  await db.delete(organizationTemplates).where(eq(organizationTemplates.id, id));
}

/**
 * Instantiate an organization from a template.
 * Creates the org, then auto-generates roles and permissions from the template.
 */
export async function instantiateFromTemplate(templateId: string, orgData: {
  name: string;
  description?: string;
  creatorUserId: string;
}) {
  const template = await getTemplate(templateId);
  if (!template) throw new Error(`Template ${templateId} not found`);

  // Create the organization
  const org = await orgRepo.createOrganization({
    name: orgData.name,
    description: orgData.description,
  });

  // Add creator as owner
  await orgRepo.addMember(org.id, orgData.creatorUserId, 'owner');

  // Create template-defined roles with permissions
  const templateRolesData = template.templateRoles as Array<{ name: string; permissions: string[] }> || [];
  for (const roleDef of templateRolesData) {
    const role = await roleRepo.createRole({
      name: `${org.name.toLowerCase().replace(/\s+/g, '_')}_${roleDef.name}`,
      description: `Auto-generated from template "${template.name}" for org "${org.name}"`,
    });

    for (const permName of roleDef.permissions) {
      await roleRepo.createPermission({
        name: permName,
        roleId: role.id,
      });
    }

    // Assign the role to the creator
    await roleRepo.assignRole({
      roleId: role.id,
      userId: orgData.creatorUserId,
      organizationId: org.id,
    });
  }

  return { org, template, rolesCreated: templateRolesData.length };
}
