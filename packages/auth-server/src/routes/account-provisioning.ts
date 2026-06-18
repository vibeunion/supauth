// Account provisioning and public self-service account claiming.

import { Elysia } from 'elysia';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import * as accountProvisioning from '../repositories/account-provisioning.js';
import * as auditRepo from '../repositories/audit.js';
import * as tenantConfigRepo from '../repositories/tenant-config.js';
import { batchGenerateEmails, nameToPinyinBase } from '../utils/email-generator.js';
import { syncEmployeeStatuses, reconcileAllEmployeeStatuses } from '../sync/employee-status.js';

const adapter = getSupaCloudAdapter();
const CLAIM_LIMIT_WINDOW_MS = 60_000;
const CLAIM_LIMIT_MAX = 12;
const claimAttempts = new Map<string, { count: number; resetAt: number }>();

interface ImportPayload {
  records?: accountProvisioning.AccountProvisioningImportRecord[];
  create_users?: boolean;
  dry_run?: boolean;
  /** Auto-generate pinyin emails for records without an explicit email. Default: true */
  generate_emails?: boolean;
  /** Email domain for auto-generated addresses. Defaults to env or "example.com". */
  email_domain?: string;
}

type AccountClaimConfig = {
  enabled: boolean;
  external_type: string;
  password: {
    mode: accountProvisioning.AccountClaimPasswordMode;
    min_length: number;
  };
  phrases: Record<string, Record<string, string>>;
};

const DEFAULT_ACCOUNT_CLAIM_CONFIG: AccountClaimConfig = {
  enabled: true,
  external_type: 'employee',
  password: {
    mode: 'show_initial_password',
    min_length: 8,
  },
  phrases: {},
};

function defaultProvisioningEmailDomain(): string {
  return (
    process.env.SUPAUTH_ACCOUNT_PROVISIONING_EMAIL_DOMAIN
    || process.env.ACCOUNT_PROVISIONING_EMAIL_DOMAIN
    || 'example.com'
  ).replace(/^@/, '').toLowerCase();
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

function asPasswordMode(value: unknown): accountProvisioning.AccountClaimPasswordMode {
  return value === 'set_on_claim' ? 'set_on_claim' : 'show_initial_password';
}

function asPositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(numberValue)));
}

function sanitizePhrases(value: unknown): Record<string, Record<string, string>> {
  if (!isRecord(value)) return {};
  const result: Record<string, Record<string, string>> = {};
  for (const [locale, messages] of Object.entries(value)) {
    if (!isRecord(messages)) continue;
    const normalizedLocale = locale.trim();
    if (!normalizedLocale) continue;
    const entries = Object.entries(messages)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length <= 500);
    if (entries.length > 0) result[normalizedLocale] = Object.fromEntries(entries);
  }
  return result;
}

export function sanitizeAccountClaimConfig(config: unknown): AccountClaimConfig {
  const source = isRecord(config) && isRecord(config.value) ? config.value : config;
  const value = isRecord(source) ? source : {};
  const password = isRecord(value.password) ? value.password : {};
  const enabled = isRecord(config) && typeof config.enabled === 'boolean'
    ? config.enabled
    : value.enabled !== false;

  return {
    enabled,
    external_type: typeof value.external_type === 'string' && value.external_type.trim()
      ? value.external_type.trim()
      : DEFAULT_ACCOUNT_CLAIM_CONFIG.external_type,
    password: {
      mode: asPasswordMode(password.mode || value.password_mode),
      min_length: asPositiveInt(
        password.min_length || value.password_min_length,
        DEFAULT_ACCOUNT_CLAIM_CONFIG.password.min_length,
        6,
        128,
      ),
    },
    phrases: sanitizePhrases(value.phrases),
  };
}

async function readAccountClaimConfig() {
  const config = await tenantConfigRepo.getTenantConfig('account_claim', 'default');
  return sanitizeAccountClaimConfig(config || {});
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

async function updateClaimedUserPassword(
  target: accountProvisioning.AccountClaimPasswordUpdateTarget,
  password: string,
) {
  const existing = unwrapUser(await adapter.getUser(target.userId) as Record<string, unknown>);
  await adapter.updateUser(target.userId, {
    email: typeof existing.email === 'string' ? existing.email : target.email,
    password,
    user_metadata: isRecord(existing.user_metadata) ? existing.user_metadata : {},
    app_metadata: isRecord(existing.app_metadata) ? existing.app_metadata : {},
  });
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

export function mergeUserPayload(
  user: Record<string, unknown>,
  record: accountProvisioning.AccountProvisioningImportRecord,
  password?: string,
) {
  const appMetadata = isRecord(user.app_metadata) ? user.app_metadata : {};
  const userMetadata = isRecord(user.user_metadata) ? user.user_metadata : {};
  const existingSupaOAuth = isRecord(appMetadata.supaoauth) ? appMetadata.supaoauth : {};
  const payload = buildUserPayload(record);
  const nextAppMetadata: Record<string, unknown> = isRecord(payload.app_metadata) ? payload.app_metadata : {};
  const nextSupaOAuth = isRecord(nextAppMetadata.supaoauth) ? nextAppMetadata.supaoauth : {};

  return {
    ...(password ? { password } : {}),
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

export function resolveProvisioningInitialPassword(
  record: accountProvisioning.AccountProvisioningImportRecord,
  existingRecord?: {
    initialPasswordEncrypted?: string | null;
    initialPasswordClaimed?: boolean | null;
  } | null,
) {
  if (existingRecord?.initialPasswordClaimed) return undefined;
  if (record.initial_password) return record.initial_password;
  if (existingRecord?.initialPasswordEncrypted) {
    return accountProvisioning.decryptInitialPassword(existingRecord.initialPasswordEncrypted);
  }
  return accountProvisioning.generateInitialPassword();
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
  getConfig?: () => Promise<AccountClaimConfig>;
  updatePassword?: (target: accountProvisioning.AccountClaimPasswordUpdateTarget, password: string) => Promise<void>;
}) {
  const claimAccount = options?.claimAccount || accountProvisioning.claimAccount;
  const getConfig = options?.getConfig || readAccountClaimConfig;
  const updatePassword = options?.updatePassword || updateClaimedUserPassword;

  return new Elysia({ prefix: '/v1/public/account-claims' })
    .get('/config', async () => {
      return { success: true, config: await getConfig() };
    }, {
      detail: { summary: 'Get public account claim configuration', tags: ['Public', 'Account Provisioning'] },
    })
    .post('/claim', async ({ body, headers, set }) => {
      const ip = requestIp(headers as Record<string, string | undefined>);
      if (!consumeClaimLimit(ip)) {
        set.status = 429;
        return { success: false, error: { code: 'too_many_attempts', message: 'Too many attempts. Please try again later.' } };
      }

      const config = await getConfig();
      if (!config.enabled) {
        set.status = 403;
        return { success: false, error: { code: 'account_claim_disabled', message: 'Account claiming is disabled.' } };
      }

      const data = body as {
        display_name?: string;
        name?: string;
        external_id?: string;
        external_type?: string;
        new_password?: string;
      };
      const displayName = String(data?.display_name || data?.name || '').trim();
      const externalId = String(data?.external_id || '').trim();
      const externalType = String(data?.external_type || config.external_type || 'generic').trim() || 'generic';
      if (!displayName || !externalId) {
        set.status = 400;
        return { success: false, error: { code: 'invalid_request', message: 'Display name and external ID are required.' } };
      }
      const passwordMode = config.password.mode;
      const newPassword = String(data?.new_password || '');
      if (passwordMode === 'set_on_claim' && newPassword.length < config.password.min_length) {
        set.status = 400;
        return {
          success: false,
          error: {
            code: 'password_too_short',
            message: `Password must be at least ${config.password.min_length} characters.`,
          },
        };
      }

      const headerMap = headers as Record<string, string | undefined>;
      const result = await claimAccount({
        displayName,
        externalId,
        externalType,
        ip,
        userAgent: headerMap['user-agent'],
        passwordMode,
        newPassword: passwordMode === 'set_on_claim' ? newPassword : undefined,
        updatePassword: passwordMode === 'set_on_claim' ? updatePassword : undefined,
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
        ...('passwordSet' in result ? { password_set: result.passwordSet } : { initial_password: result.initialPassword }),
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
    const generateEmails = payload.generate_emails !== false;
    const emailDomain = (payload.email_domain || defaultProvisioningEmailDomain()).replace(/^@/, '').toLowerCase();
    const summary = {
      total: records.length,
      eligible: 0,
      skipped: 0,
      upserted: 0,
      users_created: 0,
      users_updated: 0,
      users_suspended: 0,
      passwords_reset: 0,
      emails_generated: 0,
      errors: [] as Array<{ external_id?: string; email?: string; error: string }>,
    };

    const users = createUsers && !dryRun ? extractUsers(await adapter.listUsers()) : [];
    const byEmail = new Map<string, Record<string, unknown>>(
      users.map(user => [userEmail(user), user] as [string, Record<string, unknown>]).filter(([email]) => !!email),
    );
    const byExternalKey = new Map<string, Record<string, unknown>>(
      users.map(user => [userExternalKey(user), user] as [string, Record<string, unknown>]).filter(([key]) => !!key),
    );

    // Auto-generate pinyin emails for records without explicit email
    const needsEmail = generateEmails ? records.filter(r => !r.email?.trim()) : [];
    let generatedEmails: Map<string, string> = new Map();
    if (needsEmail.length > 0) {
      const existingLocals = new Set<string>();
      for (const user of users) {
        const email = userEmail(user);
        if (email) existingLocals.add(email.split('@')[0]);
      }
      // Also include emails already specified in the import batch
      for (const r of records) {
        if (r.email?.trim()) existingLocals.add(r.email.trim().toLowerCase().split('@')[0]);
      }
      // Also include existing provisioning records
      try {
        const existingRecords = await accountProvisioning.listAccountProvisioningRecords(500, 0);
        for (const er of existingRecords) {
          if (er.email) existingLocals.add(er.email.split('@')[0]);
        }
      } catch {}
      generatedEmails = batchGenerateEmails(
        needsEmail.map(r => ({ display_name: r.display_name, external_id: r.external_id || '' })),
        existingLocals,
        { domain: emailDomain },
      );
      summary.emails_generated = generatedEmails.size;
    }

    for (const record of records) {
      const externalId = accountProvisioning.normalizeExternalId(record.external_id || '');
      const sourceStatus = record.source_status || 'active';
      const statusIsActive = ['active', '正常'].includes(sourceStatus);
      const key = externalKey({ ...record, external_id: externalId });

      // Auto-generate email if not provided
      if (!record.email?.trim() && generatedEmails.has(externalId)) {
        record.email = generatedEmails.get(externalId)!;
      } else if (!record.email?.trim()) {
        record.email = `${nameToPinyinBase(record.display_name)}@${emailDomain}`;
      }
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
        const existingProvisioningRecord = await accountProvisioning.findRecordByExternalId(externalId, record.external_type || 'generic');
        const password = resolveProvisioningInitialPassword(record, existingProvisioningRecord);
        let userIdForRecord = existingUser ? userId(existingUser) : null;

        if (createUsers) {
          if (existingUser && userIdForRecord) {
            await adapter.updateUser(userIdForRecord, mergeUserPayload(existingUser, { ...record, external_id: externalId }, password));
            summary.users_updated += 1;
            if (password) summary.passwords_reset += 1;
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
  })
  .post('/sync', async ({ body }) => {
    const payload = body as {
      records?: Array<{ external_id: string; source_status: string; display_name?: string; email?: string }>;
      external_type?: string;
      suspend_users?: boolean;
      reactivate_users?: boolean;
      dry_run?: boolean;
    };
    if (!Array.isArray(payload.records) || payload.records.length === 0) {
      return { total: 0, unchanged: 0, updated: 0, suspended: 0, reactivated: 0, errors: [] };
    }
    return syncEmployeeStatuses({
      records: payload.records,
      external_type: payload.external_type,
      suspend_users: payload.suspend_users,
      reactivate_users: payload.reactivate_users,
      dry_run: payload.dry_run,
    });
  }, {
    detail: { summary: 'Sync employee status changes (suspend/reactivate GoTrue users)', tags: ['Account Provisioning', 'Sync'] },
  })
  .post('/sync/reconcile', async ({ body }) => {
    const payload = body as { external_type?: string; dry_run?: boolean; batch_size?: number };
    return reconcileAllEmployeeStatuses({
      externalType: payload.external_type,
      dryRun: payload.dry_run,
      batchSize: payload.batch_size,
    });
  }, {
    detail: { summary: 'Full reconciliation: scan all provisioning records and sync GoTrue user state', tags: ['Account Provisioning', 'Sync'] },
  })
  .get('/sync/status', async ({ query }) => {
    const externalType = String(query.external_type || 'employee');
    const counts = await accountProvisioning.countBySourceStatus(externalType);
    return { external_type: externalType, counts };
  }, {
    detail: { summary: 'Get employee status distribution counts', tags: ['Account Provisioning', 'Sync'] },
  });
