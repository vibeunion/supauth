// Organization template repository (P0-18) — backed by SupaCloud Postgres

import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { organizationTemplates } from '../db/schema.js';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';

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
  const [deleted] = await db.delete(organizationTemplates)
    .where(and(
      eq(organizationTemplates.id, id),
      eq(organizationTemplates.isDefault, false),
    ))
    .returning({ id: organizationTemplates.id });
  if (deleted) return 'deleted' as const;

  const template = await getTemplate(id);
  return template?.isDefault ? 'protected' as const : 'not_found' as const;
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
  const adapter = getSupaCloudAdapter();

  const org = await adapter.createOrganization({
    name: orgData.name,
    description: orgData.description,
  }) as Record<string, unknown>;
  const orgId = String(org.id || org.organization_id || '');
  const orgName = String(org.name || orgData.name);
  if (!orgId) throw new Error('SupaCloud createOrganization response did not include an organization id');

  await adapter.addOrganizationMember(orgId, {
    user_id: orgData.creatorUserId,
    role: 'owner',
  });

  const templateRolesData = template.templateRoles as Array<{ name: string; permissions: string[] }> || [];
  for (const roleDef of templateRolesData) {
    const role = await adapter.createRole({
      name: `${orgName.toLowerCase().replace(/\s+/g, '_')}_${roleDef.name}`,
      description: `Auto-generated from template "${template.name}" for org "${orgName}"`,
      organization_id: orgId,
    }) as Record<string, unknown>;
    const roleId = String(role.id || role.role_id || '');
    if (!roleId) throw new Error('SupaCloud createRole response did not include a role id');

    for (const permName of roleDef.permissions) {
      await adapter.createPermission(roleId, {
        name: permName,
      });
    }

    await adapter.assignRole(roleId, {
      user_id: orgData.creatorUserId,
      organization_id: orgId,
    });
  }

  return {
    org: { ...org, id: orgId, name: orgName },
    template,
    rolesCreated: templateRolesData.length,
  };
}
