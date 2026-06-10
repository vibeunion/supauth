// Account provisioning and public self-service account claiming.

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as accountProvisioning from '../repositories/account-provisioning.js';
import * as auditRepo from '../repositories/audit.js';

const adapter = getSupaCloudAdapter();
const CLAIM_LIMIT_WINDOW_MS = 60_000;
const CLAIM_LIMIT_MAX = 12;
const claimAttempts = new Map<string, { count: number; resetAt: number }>();

interface ImportPayload {
  records?: accountProvisioning.AccountProvisioningImportRecord[];
  create_users?: boolean;
  dry_run?: boolean;
}

function requestIp(headers: Record<string, string | undefined>): string {
  return (headers['x-forwarded-for'] || headers['x-real-ip'] || 'unknown').split(',')[0].trim();
}

function consumeClaimLimit(ip: string): boolean {
  const now = Date.now();
  const current = claimAttempts.get(ip);
  if (!current || current.resetAt <= now) {
    claimAttempts.set(ip, { count: 1, resetAt: now + CLAIM_LIMIT_WINDOW_MS });
    return true;
  }
  if (current.count >= CLAIM_LIMIT_MAX) return false;
  current.count += 1;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractUsers(response: unknown): Record<string, unknown>[] {
  if (Array.isArray(response)) return response.filter(isRecord);
  if (!isRecord(response)) return [];
  for (const key of ['users', 'items', 'data']) {
    const value = response[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

function userId(user: Record<string, unknown>): string | null {
  const source = unwrapUser(user);
  return typeof source?.id === 'string' ? source.id : null;
}

function userEmail(user: Record<string, unknown>): string {
  const source = unwrapUser(user);
  return typeof source?.email === 'string' ? source.email.toLowerCase() : '';
}

function userExternalKey(user: Record<string, unknown>): string {
  const source = unwrapUser(user);
  const appMetadata = isRecord(source?.app_metadata) ? source.app_metadata : {};
  const supaoauth = isRecord(appMetadata.supaoauth) ? appMetadata.supaoauth : {};
  const externalType = typeof supaoauth.external_type === 'string'
    ? supaoauth.external_type
    : (typeof supaoauth.employee_id === 'string' ? 'employee' : '');
  const typedIdKey = externalType ? `${externalType.replace(/[^a-zA-Z0-9_]/g, '_')}_id` : '';
  const typedExternalId = typedIdKey && typeof supaoauth[typedIdKey] === 'string' ? String(supaoauth[typedIdKey]) : '';
  const externalId = typeof supaoauth.external_id === 'string' ? supaoauth.external_id : typedExternalId;
  return externalId ? `${externalType}:${externalId}` : '';
}

function unwrapUser(value: Record<string, unknown>): Record<string, unknown> {
  for (const key of ['user', 'data']) {
    const nested = value[key];
    if (isRecord(nested) && typeof nested.id === 'string') return nested;
  }
  return value;
}

function typedExternalIdMetadata(record: accountProvisioning.AccountProvisioningImportRecord) {
  const externalType = (record.external_type || 'generic').trim();
  if (!externalType || externalType === 'generic') return {};
  const key = `${externalType.replace(/[^a-zA-Z0-9_]/g, '_')}_id`;
  return { [key]: record.external_id };
}

function externalKey(record: accountProvisioning.AccountProvisioningImportRecord) {
  return `${record.external_type || 'generic'}:${accountProvisioning.normalizeExternalId(record.external_id || '')}`;
}

function buildUserPayload(record: accountProvisioning.AccountProvisioningImportRecord, password?: string) {
  const metadata = record.metadata || {};
  return {
    email: record.email,
    ...(password ? { password } : {}),
    email_confirm: true,
    email_confirmed: true,
    user_metadata: {
      name: record.display_name,
      full_name: record.display_name,
      ...(record.profile || {}),
    },
    app_metadata: {
      supaoauth: {
        ...typedExternalIdMetadata(record),
        external_id: record.external_id,
        external_type: record.external_type || 'generic',
        source_status: record.source_status || 'active',
        source: metadata.source || 'account-provisioning',
        profile: record.profile || {},
      },
    },
  };
}

function mergeUserPayload(user: Record<string, unknown>, record: accountProvisioning.AccountProvisioningImportRecord) {
  const appMetadata = isRecord(user.app_metadata) ? user.app_metadata : {};
  const userMetadata = isRecord(user.user_metadata) ? user.user_metadata : {};
  const existingSupaOAuth = isRecord(appMetadata.supaoauth) ? appMetadata.supaoauth : {};
  const payload = buildUserPayload(record);
  const nextAppMetadata: Record<string, unknown> = isRecord(payload.app_metadata) ? payload.app_metadata : {};
  const nextSupaOAuth = isRecord(nextAppMetadata.supaoauth) ? nextAppMetadata.supaoauth : {};

  return {
    email: record.email,
    user_metadata: {
      ...userMetadata,
      name: record.display_name,
      full_name: record.display_name,
      ...(record.profile || {}),
    },
    app_metadata: {
      ...appMetadata,
      supaoauth: {
        ...existingSupaOAuth,
        ...nextSupaOAuth,
      },
    },
  };
}

async function audit(eventType: string, resourceId: string, details?: Record<string, unknown>) {
  try {
    await auditRepo.logAudit({
      eventType,
      actorType: 'admin',
      resourceType: 'account_provisioning_record',
      resourceId,
      details,
    });
  } catch {}
}

export function createPublicAccountClaimRoutes(options?: {
  claimAccount?: typeof accountProvisioning.claimAccount;
}) {
  const claimAccount = options?.claimAccount || accountProvisioning.claimAccount;

  return new Elysia({ prefix: '/v1/public/account-claims' })
    .post('/claim', async ({ body, headers, set }) => {
      const ip = requestIp(headers as Record<string, string | undefined>);
      if (!consumeClaimLimit(ip)) {
        set.status = 429;
        return { success: false, error: { code: 'too_many_attempts', message: 'Too many attempts. Please try again later.' } };
      }

      const data = body as { display_name?: string; name?: string; external_id?: string; external_type?: string };
      const displayName = String(data?.display_name || data?.name || '').trim();
      const externalId = String(data?.external_id || '').trim();
      const externalType = String(data?.external_type || 'generic').trim() || 'generic';
      if (!displayName || !externalId) {
        set.status = 400;
        return { success: false, error: { code: 'invalid_request', message: 'Display name and external ID are required.' } };
      }

      const headerMap = headers as Record<string, string | undefined>;
      const result = await claimAccount({
        displayName,
        externalId,
        externalType,
        ip,
        userAgent: headerMap['user-agent'],
      });

      if (result.status === 'not_found') {
        set.status = 404;
        return { success: false, error: { code: 'account_not_found', message: 'Account not found.' } };
      }
      if (result.status === 'already_claimed') {
        return {
          success: true,
          status: result.status,
          email: result.email,
          message: 'Initial password has already been claimed.',
        };
      }
      if (result.status === 'password_unavailable') {
        return {
          success: true,
          status: result.status,
          email: result.email,
          message: 'Initial password is unavailable. Please contact an administrator.',
        };
      }

      return {
        success: true,
        status: result.status,
        email: result.email,
        initial_password: result.initialPassword,
      };
    }, {
      detail: { summary: 'Claim a pre-provisioned SupaOAuth account', tags: ['Public', 'Account Provisioning'] },
    });
}

export const publicAccountClaimRoutes = createPublicAccountClaimRoutes();

export const accountProvisioningRoutes = new Elysia({ prefix: '/v1/account-provisioning' })
  .post('/import', async ({ body }) => {
    const payload = body as ImportPayload;
    const records = Array.isArray(payload.records) ? payload.records : [];
    const createUsers = payload.create_users === true;
    const dryRun = payload.dry_run === true;
    const summary = {
      total: records.length,
      eligible: 0,
      skipped: 0,
      upserted: 0,
      users_created: 0,
      users_updated: 0,
      users_suspended: 0,
      errors: [] as Array<{ external_id?: string; email?: string; error: string }>,
    };

    const users = createUsers && !dryRun ? extractUsers(await adapter.listUsers()) : [];
    const byEmail = new Map<string, Record<string, unknown>>(
      users.map(user => [userEmail(user), user] as [string, Record<string, unknown>]).filter(([email]) => !!email),
    );
    const byExternalKey = new Map<string, Record<string, unknown>>(
      users.map(user => [userExternalKey(user), user] as [string, Record<string, unknown>]).filter(([key]) => !!key),
    );

    for (const record of records) {
      const externalId = accountProvisioning.normalizeExternalId(record.external_id || '');
      const sourceStatus = record.source_status || 'active';
      const statusIsActive = ['active', '正常'].includes(sourceStatus);
      const key = externalKey({ ...record, external_id: externalId });
      if (!statusIsActive) {
        summary.skipped += 1;
        const existingUser = byExternalKey.get(key);
        if (createUsers && !dryRun && existingUser) {
          const id = userId(existingUser);
          if (id) {
            try {
              await adapter.suspendUser(id, { reason: 'account_provisioning_status', source_status: sourceStatus });
              summary.users_suspended += 1;
            } catch (e) {
              summary.errors.push({ external_id: externalId, error: e instanceof Error ? e.message : String(e) });
            }
          }
        }
        continue;
      }

      summary.eligible += 1;
      if (dryRun) continue;

      try {
        const existingUser = byExternalKey.get(key) || byEmail.get(record.email.toLowerCase());
        const password = existingUser ? undefined : record.initial_password || accountProvisioning.generateInitialPassword();
        let userIdForRecord = existingUser ? userId(existingUser) : null;

        if (createUsers) {
          if (existingUser && userIdForRecord) {
            await adapter.updateUser(userIdForRecord, mergeUserPayload(existingUser, { ...record, external_id: externalId }));
            summary.users_updated += 1;
          } else {
            const created = await adapter.createUser(buildUserPayload({ ...record, external_id: externalId }, password)) as Record<string, unknown>;
            userIdForRecord = userId(created);
            summary.users_created += 1;
          }
        }

        await accountProvisioning.upsertAccountProvisioningRecord({
          ...record,
          external_id: externalId,
          user_id: userIdForRecord,
          initial_password: password,
          generate_initial_password: !!password,
          source_status: sourceStatus,
        });
        summary.upserted += 1;
      } catch (e) {
        summary.errors.push({
          external_id: externalId,
          email: record.email,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    await audit('account_provisioning.import', 'batch', {
      total: summary.total,
      eligible: summary.eligible,
      skipped: summary.skipped,
      upserted: summary.upserted,
      users_created: summary.users_created,
      users_updated: summary.users_updated,
      users_suspended: summary.users_suspended,
      error_count: summary.errors.length,
      dry_run: dryRun,
      create_users: createUsers,
    });

    return summary;
  }, {
    detail: { summary: 'Import or sync account provisioning records and optionally create SupaOAuth users', tags: ['Account Provisioning', 'Users'] },
  })
  .get('/records', async ({ query }) => {
    const limit = Math.min(Number(query.limit || 100), 500);
    const offset = Number(query.offset || 0);
    const items = await accountProvisioning.listAccountProvisioningRecords(limit, offset);
    return { items, total: items.length };
  }, {
    detail: { summary: 'List account provisioning records without initial passwords', tags: ['Account Provisioning'] },
  });
