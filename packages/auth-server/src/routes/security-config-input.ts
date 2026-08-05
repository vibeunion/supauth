import type { AdminPrincipal } from '../auth/admin-permissions.js';
import type { SecurityConfigRow } from '../repositories/security-config.js';
import { ApiContractError } from '../utils/api-contract.js';

type SecurityConfigUpdate = Partial<Omit<SecurityConfigRow, 'id'>>;
type FieldValidator = (candidate: unknown) => unknown;

export interface SecurityConfigValidationContext {
  currentAdminEmail?: string;
  authorizationSource?: AdminPrincipal['authorization_source'];
  runtimeEnvironment?: string;
}

function invalidSecurityConfig(field: string) {
  return new ApiContractError(
    400,
    'invalid_security_config',
    `Invalid security configuration field: ${field}`,
    { field },
  );
}

function booleanField(field: string): FieldValidator {
  return (candidate) => {
    if (typeof candidate !== 'boolean') throw invalidSecurityConfig(field);
    return candidate;
  };
}

function boundedInteger(field: string, maximum: number): FieldValidator {
  return (candidate) => {
    if (!Number.isSafeInteger(candidate) || Number(candidate) < 1 || Number(candidate) > maximum) {
      throw invalidSecurityConfig(field);
    }
    return candidate;
  };
}

function boundedStringList(field: string): FieldValidator {
  return (candidate) => {
    const entries = Array.isArray(candidate) ? [...candidate] : null;
    if (
      !entries
      || entries.length > 1000
      || !entries.every(entry => typeof entry === 'string'
        && entry.length > 0
        && entry.length <= 320
        && entry.trim() === entry)
    ) throw invalidSecurityConfig(field);
    return entries;
  };
}

function emptyStringList(field: string): FieldValidator {
  const stringList = boundedStringList(field);
  return (candidate) => {
    const entries = stringList(candidate) as string[];
    if (entries.length > 0) throw invalidSecurityConfig(field);
    return entries;
  };
}

const SECURITY_CONFIG_VALIDATORS: Record<string, FieldValidator> = {
  adminAuthMode: (candidate) => {
    if (candidate !== 'auto' && candidate !== 'sso' && candidate !== 'token') {
      throw invalidSecurityConfig('adminAuthMode');
    }
    return candidate;
  },
  adminAllowedEmails: boundedStringList('adminAllowedEmails'),
  adminAllowedDomains: emptyStringList('adminAllowedDomains'),
  rateLimitRpm: boundedInteger('rateLimitRpm', 1_000_000),
  rateLimitBurst: boundedInteger('rateLimitBurst', 1_000_000),
  bruteForceProtection: booleanField('bruteForceProtection'),
  maxLoginAttempts: boundedInteger('maxLoginAttempts', 10_000),
  lockoutDurationSec: boundedInteger('lockoutDurationSec', 2_592_000),
  secretRotationReminderDays: boundedInteger('secretRotationReminderDays', 3650),
  enforceHttps: booleanField('enforceHttps'),
};

function normalizedEmail(email: string) {
  return email.trim().toLowerCase();
}

function assertCurrentAdminRetained(update: SecurityConfigUpdate, currentAdminEmail?: string) {
  const emails = update.adminAllowedEmails;
  if (!emails) return;
  if (!currentAdminEmail || !emails.some(email => normalizedEmail(email) === normalizedEmail(currentAdminEmail))) {
    throw invalidSecurityConfig('adminAllowedEmails');
  }
}

function assertTokenModeTransitionAllowed(
  update: SecurityConfigUpdate,
  context: SecurityConfigValidationContext,
) {
  if (update.adminAuthMode !== 'token') return;
  if (
    context.runtimeEnvironment === undefined
    || context.runtimeEnvironment === 'production'
    || context.authorizationSource !== 'development_token'
  ) throw invalidSecurityConfig('adminAuthMode');
}

function assertSafeAdminAccessUpdate(
  update: SecurityConfigUpdate,
  context: SecurityConfigValidationContext,
) {
  const mode = update.adminAuthMode;
  const emails = update.adminAllowedEmails;
  if ((mode === 'auto' || mode === 'sso') && (!emails || emails.length === 0)) {
    throw invalidSecurityConfig('adminAllowedEmails');
  }
  if (emails?.length === 0) {
    throw invalidSecurityConfig('adminAllowedEmails');
  }
  assertTokenModeTransitionAllowed(update, context);
  assertCurrentAdminRetained(update, context.currentAdminEmail);
}

export function validatedSecurityConfigUpdate(
  body: unknown,
  context: SecurityConfigValidationContext = {},
): SecurityConfigUpdate {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw invalidSecurityConfig('body');
  }
  const entries = Object.entries(body as Record<string, unknown>);
  if (entries.length === 0) throw invalidSecurityConfig('body');
  const update = Object.fromEntries(entries.map(([field, candidate]) => {
    const validator = SECURITY_CONFIG_VALIDATORS[field];
    if (!validator) throw invalidSecurityConfig(field);
    return [field, validator(candidate)];
  })) as SecurityConfigUpdate;
  assertSafeAdminAccessUpdate(update, context);
  return update;
}
