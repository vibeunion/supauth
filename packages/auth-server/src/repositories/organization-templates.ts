// Organization template repository (P0-18) — backed by SupaCloud Postgres

import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { organizationTemplateInstantiations, organizationTemplates } from '../db/schema.js';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import { ApiContractError } from '../utils/api-contract.js';
import { Type, decodeSchema, type Static, type TSchema } from '../../../shared/src/schema.js';
import { InstantiatedOrganizationSchema, OrganizationTemplateSchema } from '../../../shared/src/sdk-models.js';

export type OrgTemplate = typeof organizationTemplates.$inferSelect;
export type OrganizationTemplateInstantiationResult = Static<typeof InstantiatedOrganizationSchema> & { replayed?: boolean };

type CreatedResourceKind = 'organization' | 'role' | 'permission';
const receiptId = Type.String({ minLength: 1, pattern: '\\S' });
const OrganizationReceiptSchema = Type.Union([
  Type.Object({ id: receiptId, organization_id: Type.Optional(receiptId), name: Type.Optional(Type.String()) }),
  Type.Object({ id: Type.Optional(receiptId), organization_id: receiptId, name: Type.Optional(Type.String()) }),
]);
const RoleReceiptSchema = Type.Union([
  Type.Object({ id: receiptId, role_id: Type.Optional(receiptId) }),
  Type.Object({ id: Type.Optional(receiptId), role_id: receiptId }),
]);
const PermissionReceiptSchema = Type.Union([
  Type.Object({ id: receiptId, permission_id: Type.Optional(receiptId) }),
  Type.Object({ id: Type.Optional(receiptId), permission_id: receiptId }),
]);

function decodeCreationReceipt<S extends TSchema>(schema: S, value: unknown): Static<S> {
  try {
    return decodeSchema(schema, value);
  } catch {
    throw new ApiContractError(502, 'invalid_upstream_response', 'SupaCloud creation returned an invalid receipt');
  }
}

function confirmedReceiptId(primary: string | undefined, legacy: string | undefined): string {
  const id = primary ?? legacy;
  if (!id?.trim()) {
    throw new ApiContractError(502, 'invalid_upstream_response', 'SupaCloud creation returned an invalid receipt');
  }
  return id;
}

const DEFAULT_TEMPLATE_LOCK_KEY = 'supaoauth.organization_templates.default';
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:+/-]{1,255}$/;
type TemplateExecutor = Pick<ReturnType<typeof getDb>, 'select' | 'update' | 'insert' | 'delete'>;
export const ORGANIZATION_TEMPLATE_DEFAULT_UNIQUE_INDEX_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS "uq_organization_templates_single_default"
ON "supaoauth"."organization_templates" ("is_default")
WHERE "is_default" = true
`;

async function withDefaultTemplateLock<T>(
  db: ReturnType<typeof getDb>,
  operation: (transaction: TemplateExecutor) => Promise<T>,
) {
  return db.transaction(async (transaction) => {
    // The unique partial index is installed by the hosted migration. The
    // advisory lock keeps replacement ordered while older installations are
    // being upgraded.
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${DEFAULT_TEMPLATE_LOCK_KEY}, 0))`);
    return operation(transaction);
  });
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
  const write = async (executor: TemplateExecutor) => {
    if (data.isDefault) {
      await executor.update(organizationTemplates)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(organizationTemplates.isDefault, true));
    }

    const [template] = await executor.insert(organizationTemplates).values({
      name: data.name,
      description: data.description || null,
      templateRoles: data.templateRoles || [],
      templateScopes: data.templateScopes || [],
      isDefault: data.isDefault ?? false,
    }).returning();
    return template;
  };

  return data.isDefault ? withDefaultTemplateLock(db, write) : write(db);
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
  const write = async (executor: TemplateExecutor) => {
    const [current] = await executor.select({ id: organizationTemplates.id })
      .from(organizationTemplates)
      .where(eq(organizationTemplates.id, id))
      .limit(1);
    if (!current) return undefined;

    if (data.isDefault) {
      await executor.update(organizationTemplates)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(organizationTemplates.isDefault, true));
    }

    const [updated] = await executor.update(organizationTemplates).set({
      ...data,
      updatedAt: new Date(),
    }).where(eq(organizationTemplates.id, id)).returning();
    return updated;
  };

  return data.isDefault ? withDefaultTemplateLock(db, write) : write(db);
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

function requestHash(templateId: string, orgData: {
  name: string;
  description?: string;
  creatorUserId: string;
}): string {
  return createHash('sha256')
    .update(JSON.stringify({ templateId, ...orgData }))
    .digest('hex');
}

async function reserveInstantiation(idempotencyKey: string, templateId: string, hash: string) {
  const db = getDb();
  const [created] = await db.insert(organizationTemplateInstantiations).values({
    idempotencyKey,
    templateId,
    requestHash: hash,
    status: 'pending',
  }).onConflictDoNothing({
    target: organizationTemplateInstantiations.idempotencyKey,
  }).returning();
  if (created) return null;

  const [existing] = await db.select().from(organizationTemplateInstantiations)
    .where(eq(organizationTemplateInstantiations.idempotencyKey, idempotencyKey))
    .limit(1);
  if (!existing) {
    throw new ApiContractError(503, 'idempotency_state_unavailable', 'Instantiation idempotency state is unavailable');
  }
  if (existing.requestHash !== hash || existing.templateId !== templateId) {
    throw new ApiContractError(409, 'idempotency_key_reused', 'Idempotency-Key was already used for a different request');
  }
  if (existing.status === 'completed') {
    if (!existing.result) {
      throw new ApiContractError(
        503,
        'idempotency_state_unavailable',
        'Completed instantiation is missing its persisted result',
        { recovery_required: true },
      );
    }
    try {
      // JSONB 回放是独立信任边界，不能把持久化 JSON 假定为带 Date 的数据库行。
      return decodeSchema(InstantiatedOrganizationSchema, existing.result);
    } catch {
      throw new ApiContractError(
        503,
        'idempotency_state_unavailable',
        'Completed instantiation has an invalid persisted result',
        { recovery_required: true },
      );
    }
  }
  if (existing.status === 'recovery_required') {
    throw new ApiContractError(
      409,
      'organization_template_recovery_required',
      'This instantiation requires recovery before it can be retried',
      existing.errorDetails || { recovery_required: true },
    );
  }
  if (existing.status === 'pending') {
    throw new ApiContractError(409, 'organization_template_operation_in_progress', 'An instantiation with this Idempotency-Key is already in progress');
  }
  if (existing.status !== 'failed') {
    throw new ApiContractError(
      503,
      'idempotency_state_unavailable',
      'Instantiation idempotency state has an unknown status',
      { status: existing.status, recovery_required: true },
    );
  }

  const [retry] = await db.update(organizationTemplateInstantiations)
    .set({ status: 'pending', errorDetails: null, updatedAt: new Date() })
    .where(and(
      eq(organizationTemplateInstantiations.idempotencyKey, idempotencyKey),
      eq(organizationTemplateInstantiations.requestHash, hash),
      eq(organizationTemplateInstantiations.status, 'failed'),
    ))
    .returning();
  if (!retry) {
    throw new ApiContractError(409, 'organization_template_operation_in_progress', 'An instantiation with this Idempotency-Key is already in progress');
  }
  return null;
}

async function finishInstantiation(
  idempotencyKey: string,
  hash: string,
  status: 'completed' | 'failed' | 'recovery_required',
  details: { result?: Record<string, unknown>; organizationId?: string | null; errorDetails?: Record<string, unknown> },
) {
  const [updated] = await getDb().update(organizationTemplateInstantiations).set({
    status,
    organizationId: details.organizationId || null,
    result: details.result || null,
    errorDetails: details.errorDetails || null,
    updatedAt: new Date(),
  }).where(and(
    eq(organizationTemplateInstantiations.idempotencyKey, idempotencyKey),
    eq(organizationTemplateInstantiations.requestHash, hash),
  )).returning({ id: organizationTemplateInstantiations.id });
  if (!updated) {
    throw new ApiContractError(
      503,
      'idempotency_state_unavailable',
      'Instantiation idempotency state could not be updated',
      { recovery_required: true },
    );
  }
}

async function finishInstantiationBestEffort(
  idempotencyKey: string,
  hash: string,
  status: 'failed' | 'recovery_required',
  details: { organizationId?: string | null; errorDetails?: Record<string, unknown> },
) {
  try {
    await finishInstantiation(idempotencyKey, hash, status, details);
  } catch {
    // Preserve the original operation or compensation error if state recording
    // is unavailable; the pending row remains visible for manual recovery.
  }
}

/**
 * Instantiate an organization from a template.
 * Creates the org, then auto-generates roles and permissions from the template.
 */
export async function instantiateFromTemplate(templateId: string, orgData: {
  name: string;
  description?: string;
  creatorUserId: string;
}, options: { idempotencyKey?: string } = {}) {
  const idempotencyKey = options.idempotencyKey?.trim();
  if (idempotencyKey && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new ApiContractError(400, 'invalid_idempotency_key', 'Idempotency-Key must contain 1 to 255 safe characters');
  }
  const template = await getTemplate(templateId);
  if (!template) {
    throw new ApiContractError(404, 'organization_template_not_found', 'Organization template was not found');
  }
  // 持久化 JSON 的静态列类型不构成校验；必须在任何远端写入前拒绝畸形模板。
  const templateRolesData = decodeSchema(
    OrganizationTemplateSchema.properties.templateRoles,
    template.templateRoles ?? [],
  );
  decodeSchema(OrganizationTemplateSchema.properties.templateScopes, template.templateScopes ?? []);
  const hash = requestHash(templateId, orgData);
  if (idempotencyKey) {
    const replay = await reserveInstantiation(idempotencyKey, templateId, hash);
    if (replay) {
      return {
        ...replay,
        replayed: true,
      };
    }
  }
  const adapter = getSupaCloudAdapter();
  let org: Record<string, unknown> | undefined;
  let orgId = '';
  let remoteOrganizationMutationStarted = false;
  let remoteResourceIdUnknown: CreatedResourceKind | null = null;
  const createdRoles: Array<{ roleId: string; permissionIds: string[] }> = [];

  try {
    remoteOrganizationMutationStarted = true;
    const organizationReceipt = await adapter.createOrganization({
      name: orgData.name,
      description: orgData.description,
    });
    // 远端写入已发生或结果未知；只有解码成功的 ID 才可用于后续写入和补偿。
    remoteResourceIdUnknown = 'organization';
    const createdOrganization = decodeCreationReceipt(OrganizationReceiptSchema, organizationReceipt);
    orgId = confirmedReceiptId(createdOrganization.id, createdOrganization.organization_id);
    org = createdOrganization;
    remoteResourceIdUnknown = null;
    const orgName = createdOrganization.name || orgData.name;

    await adapter.addOrganizationMember(orgId, {
      user_id: orgData.creatorUserId,
      role: 'owner',
    });

    for (const roleDef of templateRolesData) {
      const roleReceipt = await adapter.createRole({
        name: `${orgName.toLowerCase().replace(/\s+/g, '_')}_${roleDef.name}`,
        description: `Auto-generated from template "${template.name}" for org "${orgName}"`,
        organization_id: orgId,
      });
      remoteResourceIdUnknown = 'role';
      const role = decodeCreationReceipt(RoleReceiptSchema, roleReceipt);
      const roleId = confirmedReceiptId(role.id, role.role_id);
      remoteResourceIdUnknown = null;

      const createdRole: { roleId: string; permissionIds: string[] } = { roleId, permissionIds: [] };
      createdRoles.push(createdRole);
      for (const permName of roleDef.permissions) {
        const permissionReceipt = await adapter.createPermission(roleId, {
          name: permName,
        });
        remoteResourceIdUnknown = 'permission';
        const permission = decodeCreationReceipt(PermissionReceiptSchema, permissionReceipt);
        const permissionId = confirmedReceiptId(permission.id, permission.permission_id);
        createdRole.permissionIds.push(permissionId);
        remoteResourceIdUnknown = null;
      }

      await adapter.assignRole(roleId, {
        user_id: orgData.creatorUserId,
        organization_id: orgId,
      });
    }

    const result: {
      org: Record<string, unknown> & { id: string; name: string };
      template: OrgTemplate;
      rolesCreated: number;
      replayed?: boolean;
    } = {
      org: { ...org, id: orgId, name: orgName },
      template,
      rolesCreated: templateRolesData.length,
    };
    if (idempotencyKey) {
      try {
        await finishInstantiation(idempotencyKey, hash, 'completed', {
          result,
          organizationId: orgId,
        });
      } catch (cause) {
        throw new ApiContractError(
          503,
          'idempotency_state_unavailable',
          'Organization was created but its idempotency result could not be persisted',
          { organization_id: orgId, recovery_required: true, state_persistence_failed: true },
        );
      }
    }
    return result;
  } catch (cause) {
    const rollbackFailures: unknown[] = [];
    for (const createdRole of [...createdRoles].reverse()) {
      for (const permissionId of [...createdRole.permissionIds].reverse()) {
        try {
          await adapter.deletePermission(createdRole.roleId, permissionId);
        } catch (error) {
          rollbackFailures.push(error);
        }
      }
      try {
        await adapter.deleteRole(createdRole.roleId);
      } catch (error) {
        rollbackFailures.push(error);
      }
    }
    if (orgId) {
      try {
        await adapter.deleteOrganization(orgId);
      } catch (error) {
        rollbackFailures.push(error);
      }
    }
    if (rollbackFailures.length > 0 || remoteResourceIdUnknown || (remoteOrganizationMutationStarted && !orgId)) {
      const error = new OrganizationTemplateInstantiationError(
        orgId || null,
        rollbackFailures,
        cause,
        remoteOrganizationMutationStarted && !orgId,
        remoteResourceIdUnknown,
      );
      if (idempotencyKey) {
        await finishInstantiationBestEffort(idempotencyKey, hash, 'recovery_required', {
          organizationId: orgId || null,
          errorDetails: {
            organization_id: orgId || null,
            rollback_failures: rollbackFailures.length,
            remote_organization_id_unknown: remoteOrganizationMutationStarted && !orgId,
            ...(remoteResourceIdUnknown ? { remote_resource_id_unknown: remoteResourceIdUnknown } : {}),
            recovery_required: true,
          },
        });
      }
      throw error;
    }
    if (idempotencyKey) {
      await finishInstantiationBestEffort(idempotencyKey, hash, 'failed', {
        errorDetails: { retryable: true },
      });
    }
    throw cause;
  }
}

export class OrganizationTemplateInstantiationError extends ApiContractError {
  constructor(
    readonly organizationId: string | null,
    readonly rollbackFailures: unknown[],
    cause: unknown,
    readonly remoteOrganizationIdUnknown = false,
    readonly remoteResourceIdUnknown: CreatedResourceKind | null = null,
  ) {
    super(
      502,
      'organization_template_compensation_incomplete',
      remoteResourceIdUnknown
        ? 'Organization template creation returned an invalid receipt; the remote outcome requires recovery'
        : organizationId
        ? `Organization template instantiation failed and compensation is incomplete for organization ${organizationId}`
        : 'Organization template instantiation failed and the remote organization identity is unknown',
      {
        organization_id: organizationId,
        rollback_failures: rollbackFailures.length,
        remote_organization_id_unknown: remoteOrganizationIdUnknown,
        ...(remoteResourceIdUnknown ? { remote_resource_id_unknown: remoteResourceIdUnknown } : {}),
        recovery_required: true,
      },
    );
    this.name = 'OrganizationTemplateInstantiationError';
    this.cause = cause;
  }
}
