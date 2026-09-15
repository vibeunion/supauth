// Account provisioning and public self-service account claiming.

import { Elysia } from 'elysia';
import { decodeUserReadback } from '../utils/upstream-contract.js';
import { accountContract, accountOutput, readAccountInput, readAccountNormalization } from '../utils/account-contract.js';
import { definedFields } from '../utils/defined-fields.js';
import { getConfig } from '../config/index.js';
import { runtimeEnv } from '../config/platform-env.js';
import {
  getSupaCloudAdapter,
  getSupaCloudAdapterForProject,
  isSupaCloudApiError,
  type SupaCloudAdapter,
} from '../supacloud/adapter.js';
import * as accountProvisioning from '../repositories/account-provisioning.js';
import * as auditRepo from '../repositories/audit.js';
import * as tenantConfigRepo from '../repositories/tenant-config.js';
import { batchGenerateEmails, nameToPinyinBase } from '../utils/email-generator.js';
import { syncEmployeeStatuses, reconcileAllEmployeeStatuses } from '../sync/employee-status.js';
import {
  mergePasswordPolicies,
  passwordPolicyFromAuthConfig,
  passwordPolicyViolation,
  type PasswordPolicyViolation,
  type PublicPasswordPolicy,
} from '../utils/password-policy.js';
import { BoundedFixedWindowLimiter, resolveClientIp } from '../utils/rate-limit.js';

const adapter = getSupaCloudAdapter();
const CLAIM_LIMIT_WINDOW_MS = 60_000;
const CLAIM_LIMIT_MAX = 12;

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
    require_uppercase: boolean;
    require_lowercase: boolean;
    require_numbers: boolean;
    require_symbols: boolean;
  };
  phrases: Record<string, Record<string, string>>;
};

const DEFAULT_ACCOUNT_CLAIM_CONFIG: AccountClaimConfig = {
  enabled: false,
  external_type: 'employee',
  password: {
    mode: 'show_initial_password',
    min_length: 8,
    require_uppercase: false,
    require_lowercase: false,
    require_numbers: false,
    require_symbols: false,
  },
  phrases: {},
};

function defaultProvisioningEmailDomain(): string {
  return (
    runtimeEnv('SUPAUTH_ACCOUNT_PROVISIONING_EMAIL_DOMAIN')
    || runtimeEnv('ACCOUNT_PROVISIONING_EMAIL_DOMAIN')
    || 'example.com'
  ).replace(/^@/, '').toLowerCase();
}

function requestIp(headers: Record<string, string | undefined>): string {
  return resolveClientIp(headers, getConfig().trustProxyHeaders);
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
  const source = isRecord(config) && isRecord(config["value"]) ? config["value"] : config;
  const value = isRecord(source) ? source : {};
  const password = isRecord(value["password"]) ? value["password"] : {};
  const enabled = isRecord(config) && config["enabled"] === true;

  return {
    enabled,
    external_type: typeof value["external_type"] === 'string' && value["external_type"].trim()
      ? value["external_type"].trim()
      : DEFAULT_ACCOUNT_CLAIM_CONFIG.external_type,
    password: {
      mode: asPasswordMode(password["mode"] || value["password_mode"]),
      min_length: asPositiveInt(
        password["min_length"] || value["password_min_length"],
        DEFAULT_ACCOUNT_CLAIM_CONFIG.password.min_length,
        6,
        128,
      ),
      require_uppercase: false,
      require_lowercase: false,
      require_numbers: false,
      require_symbols: false,
    },
    phrases: sanitizePhrases(value["phrases"]),
  };
}

async function readAccountClaimConfig() {
  const config = await tenantConfigRepo.getTenantConfig('account_claim', 'default');
  return sanitizeAccountClaimConfig(config);
}

function passwordPolicyFromClaimConfig(config: AccountClaimConfig): PublicPasswordPolicy {
  return {
    min_length: config.password.min_length,
    require_uppercase: config.password.require_uppercase,
    require_lowercase: config.password.require_lowercase,
    require_numbers: config.password.require_numbers,
    require_symbols: config.password.require_symbols,
  };
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
  return typeof source?.["id"] === 'string' ? source["id"] : null;
}

function userEmail(user: Record<string, unknown>): string {
  const source = unwrapUser(user);
  return typeof source?.["email"] === 'string' ? source["email"].toLowerCase() : '';
}

function unwrapUser(value: Record<string, unknown>): Record<string, unknown> {
  for (const key of ['user', 'data']) {
    const nested = value[key];
    if (isRecord(nested) && typeof nested["id"] === 'string') return nested;
  }
  return value;
}

export function resolveAccountClaimPasswordProjectRef(input: {
  projectRef?: string;
  oauthAuthorizationProjectRef?: string;
}): string {
  const authorizationProjectRef = String(input.oauthAuthorizationProjectRef || '').trim();
  return authorizationProjectRef || String(input.projectRef || '').trim();
}

function accountClaimPasswordAdapter(): SupaCloudAdapter {
  const config = getConfig();
  const projectRef = resolveAccountClaimPasswordProjectRef({
    projectRef: config.projectRef,
    oauthAuthorizationProjectRef: config.oauthAuthorizationProjectRef,
  });
  if (!projectRef) throw new Error('No authoritative account claim password project is configured');
  return projectRef === config.projectRef ? adapter : getSupaCloudAdapterForProject(projectRef);
}

async function readAccountClaimRuntimePasswordPolicy(): Promise<PublicPasswordPolicy> {
  return passwordPolicyFromAuthConfig(await accountClaimPasswordAdapter().getAuthConfig());
}

function mergeAccountClaimPasswordPolicy(
  config: AccountClaimConfig,
  runtimePolicy: PublicPasswordPolicy,
): AccountClaimConfig {
  return {
    ...config,
    password: {
      ...config.password,
      ...mergePasswordPolicies(passwordPolicyFromClaimConfig(config), runtimePolicy),
    },
  };
}

function isWeakPasswordUpdateError(error: unknown): boolean {
  if (!isSupaCloudApiError(error, [400, 422])) return false;
  let payload: unknown;
  try {
    payload = JSON.parse(error.body);
  } catch {
    payload = null;
  }
  const record = isRecord(payload) ? payload : {};
  const code = String(record["code"] || record["error_code"] || '').toLowerCase();
  if (code === 'weak_password') return true;

  const message = String(record["message"] || record["msg"] || record["error_description"] || record["error"] || error.body).toLowerCase();
  return message.includes('weak password')
    || /password (?:should|must) be at least/.test(message)
    || /password (?:must|should) (?:include|contain|have)/.test(message)
    || /password is too short/.test(message);
}

function passwordViolationMessage(violation: PasswordPolicyViolation, minLength: number): string {
  if (violation === 'password_too_short') return `Password must be at least ${minLength} characters.`;
  if (violation === 'password_requires_uppercase') return 'Password must include an uppercase letter.';
  if (violation === 'password_requires_lowercase') return 'Password must include a lowercase letter.';
  if (violation === 'password_requires_number') return 'Password must include a number.';
  return 'Password must include a symbol.';
}

async function updateClaimedUserPassword(
  target: accountProvisioning.AccountClaimPasswordUpdateTarget,
  password: string,
) {
  await accountClaimPasswordAdapter().updateUser(target.userId, { password });
}

function buildUserPayload(record: accountProvisioning.AccountProvisioningImportRecord, password?: string) {
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
  };
}

export function mergeUserPayload(
  user: Record<string, unknown>,
  record: accountProvisioning.AccountProvisioningImportRecord,
  password?: string,
) {
  const userMetadata = isRecord(user["user_metadata"]) ? user["user_metadata"] : {};

  return {
    ...(password ? { password } : {}),
    email: record.email,
    user_metadata: {
      ...userMetadata,
      name: record.display_name,
      full_name: record.display_name,
      ...(record.profile || {}),
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
  await auditRepo.logAudit({
    eventType,
    actorType: 'admin',
    resourceType: 'account_provisioning_record',
    resourceId,
    details,
  });
}

export function createPublicAccountClaimRoutes(options?: {
  claimAccount?: typeof accountProvisioning.claimAccount;
  getConfig?: () => Promise<AccountClaimConfig>;
  getPasswordPolicy?: () => Promise<PublicPasswordPolicy>;
  updatePassword?: (target: accountProvisioning.AccountClaimPasswordUpdateTarget, password: string) => Promise<void>;
}) {
  const claimAttempts = new BoundedFixedWindowLimiter({ windowMs: CLAIM_LIMIT_WINDOW_MS });
  const claimAccount = options?.claimAccount || accountProvisioning.claimAccount;
  const getConfig = options?.getConfig || readAccountClaimConfig;
  const getPasswordPolicy = options?.getPasswordPolicy
    || (options?.getConfig ? undefined : readAccountClaimRuntimePasswordPolicy);
  const updatePassword = options?.updatePassword || updateClaimedUserPassword;
  const getEffectiveConfig = async () => {
    const config = await getConfig();
    if (!getPasswordPolicy || !config.enabled || config.password.mode !== 'set_on_claim') return config;
    return mergeAccountClaimPasswordPolicy(config, await getPasswordPolicy());
  };
  const getSafeEffectiveConfig = async () => {
    try {
      return await getEffectiveConfig();
    } catch {
      return DEFAULT_ACCOUNT_CLAIM_CONFIG;
    }
  };

  return new Elysia({ prefix: '/v1/public/account-claims' })
    .get('/config', async () => {
      return accountOutput('claimConfig', { success: true, config: await getSafeEffectiveConfig() });
    }, accountContract('claimConfig', {
      detail: { summary: 'Get public account claim configuration', tags: ['Public', 'Account Provisioning'] },
    }))
    .post('/claim', async ({ body, headers, set, request }) => {
      const ip = requestIp(headers);
      if (!claimAttempts.consume(ip, CLAIM_LIMIT_MAX)) {
        set.status = 429;
        return { success: false, error: { code: 'too_many_attempts', message: 'Too many attempts. Please try again later.' } };
      }

      const config = await getSafeEffectiveConfig();
      if (!config.enabled) {
        set.status = 403;
        return { success: false, error: { code: 'account_claim_disabled', message: 'Account claiming is disabled.' } };
      }

      const requestBody = isRecord(body) ? body : {};
      const externalId = String(requestBody?.["external_id"] || '').trim();
      if (!externalId) {
        set.status = 400;
        return { success: false, error: { code: 'invalid_request', message: 'External ID is required.' } };
      }
      const passwordMode = config.password.mode;
      const newPassword = String(requestBody?.["new_password"] || '');
      const passwordViolation = passwordMode === 'set_on_claim'
        ? passwordPolicyViolation(newPassword, passwordPolicyFromClaimConfig(config))
        : null;
      if (passwordViolation) {
        set.status = 400;
        return {
          success: false,
          error: {
            code: passwordViolation,
            message: passwordViolationMessage(passwordViolation, config.password.min_length),
          },
        };
      }

      const input = readAccountNormalization('claim', request, { external_id: externalId, new_password: newPassword });
      const headerMap = headers;
      let claimOutcome: accountProvisioning.AccountClaimResult;
      try {
        claimOutcome = await claimAccount(definedFields({
          externalId: input.external_id,
          externalType: config.external_type,
          ip,
          userAgent: headerMap['user-agent'],
          passwordMode,
          newPassword: passwordMode === 'set_on_claim' ? input.new_password : undefined,
          updatePassword: passwordMode === 'set_on_claim' ? updatePassword : undefined,
          isDefinitivePasswordRejection: isWeakPasswordUpdateError,
        }));
      } catch (error) {
        if (isWeakPasswordUpdateError(error)) {
          set.status = 400;
          return {
            success: false,
            error: {
              code: 'weak_password',
              message: 'Password does not satisfy the current password policy.',
            },
          };
        }
        set.status = 503;
        return {
          success: false,
          error: {
            code: 'account_claim_unavailable',
            message: 'Account claiming is temporarily unavailable. Please try again later.',
          },
        };
      }

      if (claimOutcome.status !== 'claimed') {
        set.status = 409;
        return {
          success: false,
          error: {
            code: 'account_claim_unavailable',
            message: 'Account cannot be claimed with the supplied credentials.',
          },
        };
      }

      return accountOutput('claim', {
        success: true,
        status: claimOutcome.status,
        email: claimOutcome.email,
        ...('passwordSet' in claimOutcome ? { password_set: claimOutcome.passwordSet } : { initial_password: claimOutcome.initialPassword }),
      });
    }, accountContract('claim', {
      detail: { summary: 'Claim a pre-provisioned SupaOAuth account', tags: ['Public', 'Account Provisioning'] },
    }));
}

export const publicAccountClaimRoutes = createPublicAccountClaimRoutes();

export const accountProvisioningRoutes = new Elysia({ prefix: '/v1/account-provisioning' })
  .post('/import', async ({ body, request }) => {
    const payload = readAccountInput('import', request, { body }).body;
    const records = Array.isArray(payload.records) ? payload.records : [];
    const createUsers = payload.create_users === true;
    const dryRun = payload.dry_run === true;
    const generateEmails = payload.generate_emails !== false;
    const emailDomain = (payload.email_domain || defaultProvisioningEmailDomain()).replace(/^@/, '').toLowerCase();
    const errors: Array<{ external_id?: string; email?: string; error: string }> = [];
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
      errors,
    };

    const users = createUsers && !dryRun ? extractUsers(await adapter.listUsers()) : [];
    const byEmail = new Map<string, Record<string, unknown>>(
      users.map((user): [string, Record<string, unknown>] => [userEmail(user), user]).filter(([email]) => !!email),
    );
    const byId = new Map<string, Record<string, unknown>>(
      users.map((user): [string | null, Record<string, unknown>] => [userId(user), user])
        .filter((entry): entry is [string, Record<string, unknown>] => entry[0] !== null),
    );

    // Auto-generate pinyin emails for records without explicit email
    const needsEmail = generateEmails ? records.filter(r => !r.email?.trim()) : [];
    let generatedEmails: Map<string, string> = new Map();
    if (needsEmail.length > 0) {
      const existingLocals = new Set<string>();
      for (const user of users) {
        const email = userEmail(user);
        const local = email.split('@')[0];
        if (email && local !== undefined) existingLocals.add(local);
      }
      // Also include emails already specified in the import batch
      for (const r of records) {
        const local = r.email?.trim().toLowerCase().split('@')[0];
        if (r.email?.trim() && local !== undefined) existingLocals.add(local);
      }
      // Also include existing provisioning records
      const existingRecords = await accountProvisioning.listAccountProvisioningRecords(500, 0);
      for (const existingRecord of existingRecords) {
        const local = existingRecord.email.split('@')[0];
        if (existingRecord.email && local !== undefined) existingLocals.add(local);
      }
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

      // Auto-generate email if not provided
      const generatedEmail = generatedEmails.get(externalId);
      if (!record.email?.trim() && generatedEmail !== undefined) {
        record.email = generatedEmail;
      } else if (!record.email?.trim()) {
        record.email = `${nameToPinyinBase(record.display_name)}@${emailDomain}`;
      }
      if (!statusIsActive) {
        summary.skipped += 1;
        if (createUsers && !dryRun) {
          try {
            const existingRecord = await accountProvisioning.findRecordByExternalId(
              externalId,
              record.external_type || 'generic',
            );
            const existingUser = existingRecord?.userId
              ? byId.get(existingRecord.userId)
              : byEmail.get(record.email.toLowerCase());
            const id = existingUser ? userId(existingUser) : null;
            if (id) {
              await adapter.suspendUser(id, { reason: 'account_provisioning_status', source_status: sourceStatus });
              summary.users_suspended += 1;
            }
          } catch (e) {
            summary.errors.push({ external_id: externalId, error: e instanceof Error ? e.message : String(e) });
          }
        }
        continue;
      }

      summary.eligible += 1;
      if (dryRun) continue;

      try {
        const existingProvisioningRecord = await accountProvisioning.findRecordByExternalId(externalId, record.external_type || 'generic');
        const existingUser = existingProvisioningRecord?.userId
          ? byId.get(existingProvisioningRecord.userId)
          : byEmail.get(record.email.toLowerCase());
        const completeRecord = { ...record, email: record.email };
        const password = resolveProvisioningInitialPassword(completeRecord, existingProvisioningRecord);
        let userIdForRecord = existingUser ? userId(existingUser) : null;

        if (createUsers) {
          if (existingUser && userIdForRecord) {
            await adapter.updateUser(userIdForRecord, mergeUserPayload(existingUser, { ...completeRecord, external_id: externalId }, password));
            summary.users_updated += 1;
            if (password) summary.passwords_reset += 1;
          } else {
            const created = decodeUserReadback(await adapter.createUser(buildUserPayload({ ...completeRecord, external_id: externalId }, password)));
            userIdForRecord = created.id;
            summary.users_created += 1;
          }
        }

        await accountProvisioning.upsertAccountProvisioningRecord(definedFields({
          ...record,
          external_id: externalId,
          user_id: userIdForRecord,
          initial_password: password,
          generate_initial_password: !!password,
          source_status: sourceStatus,
          email: record.email,
        }));
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

    return accountOutput('import', summary);
  }, accountContract('import', {
    detail: { summary: 'Import or sync account provisioning records and optionally create SupaOAuth users', tags: ['Account Provisioning', 'Users'] },
  }))
  .get('/records', async ({ query: rawQuery, request }) => {
    const { query } = readAccountInput('records', request, { query: rawQuery });
    const limit = Math.min(Number(query.limit || 100), 500);
    const offset = Number(query.offset || 0);
    const items = await accountProvisioning.listAccountProvisioningRecords(limit, offset);
    return accountOutput('records', { items, total: items.length });
  }, accountContract('records', {
    detail: { summary: 'List account provisioning records without initial passwords', tags: ['Account Provisioning'] },
  }))
  .post('/sync', async ({ body, request }) => {
    const payload = readAccountInput('sync', request, { body }).body;
    if (!Array.isArray(payload.records) || payload.records.length === 0) {
      return accountOutput('sync', { total: 0, unchanged: 0, updated: 0, suspended: 0, reactivated: 0, errors: [] });
    }
    return accountOutput('sync', await syncEmployeeStatuses(definedFields({
      records: payload.records.map(record => ({ ...record, source_status: record.source_status || 'active' })),
      external_type: payload.external_type,
      suspend_users: payload.suspend_users,
      reactivate_users: payload.reactivate_users,
      dry_run: payload.dry_run,
    })));
  }, accountContract('sync', {
    detail: { summary: 'Sync employee status changes (suspend/reactivate GoTrue users)', tags: ['Account Provisioning'] },
  }))
  .post('/sync/reconcile', async ({ body, request }) => {
    const payload = readAccountInput('reconcile', request, { body }).body;
    return accountOutput('reconcile', await reconcileAllEmployeeStatuses(definedFields({
      externalType: payload.external_type,
      dryRun: payload.dry_run,
      batchSize: payload.batch_size,
    })));
  }, accountContract('reconcile', {
    detail: { summary: 'Full reconciliation: scan all provisioning records and sync GoTrue user state', tags: ['Account Provisioning'] },
  }))
  .get('/sync/status', async ({ query: rawQuery, request }) => {
    const { query } = readAccountInput('syncStatus', request, { query: rawQuery });
    const externalType = String(query.external_type || 'employee');
    const counts = await accountProvisioning.countBySourceStatus(externalType);
    return accountOutput('syncStatus', { external_type: externalType, counts });
  }, accountContract('syncStatus', {
    detail: { summary: 'Get employee status distribution counts', tags: ['Account Provisioning'] },
  }));
