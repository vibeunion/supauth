// Public JWT-authenticated account center routes.
// These routes trust only the user's GoTrue access token and never accept
// browser-supplied user ids or service-role credentials.

import { Elysia } from 'elysia';
import { getConfig } from '../config/index.js';
import * as consentRepo from '../repositories/consents.js';
import * as auditRepo from '../repositories/audit.js';
import * as tenantConfigRepo from '../repositories/tenant-config.js';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';

interface AccountFailure {
  ok: false;
  status: number;
  code: string;
  message: string;
}

interface AccountSuccess {
  ok: true;
  user: Record<string, unknown>;
}

type AccountResult = AccountSuccess | AccountFailure;

type ListResult = { items: unknown[]; total: number };

type AccountCenterConfig = {
  enabled: boolean;
  profile: {
    edit_mode: 'disabled' | 'read_only' | 'editable';
    fields: string[];
  };
  security: {
    password_change: boolean;
    mfa: boolean;
    passkeys: boolean;
    email_change: boolean;
    phone_change: boolean;
  };
  sessions: { enabled: boolean };
  grants: { enabled: boolean };
  identities: { enabled: boolean };
  delete_account: { enabled: boolean; url: string | null };
};

const adapter = getSupaCloudAdapter();

const BLOCKED_PROFILE_KEYS = new Set([
  'app_metadata',
  'aud',
  'email',
  'encrypted_password',
  'id',
  'password',
  'phone',
  'role',
]);

const DEFAULT_ACCOUNT_CENTER_CONFIG: AccountCenterConfig = {
  enabled: true,
  profile: {
    edit_mode: 'read_only',
    fields: ['name', 'email', 'phone'],
  },
  security: {
    password_change: true,
    mfa: false,
    passkeys: false,
    email_change: false,
    phone_change: false,
  },
  sessions: { enabled: false },
  grants: { enabled: false },
  identities: { enabled: false },
  delete_account: { enabled: false, url: null },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function asModuleEnabled(value: unknown, fallback: boolean) {
  return isRecord(value) ? asBoolean(value.enabled, fallback) : fallback;
}

function asSafeFields(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_ACCOUNT_CENTER_CONFIG.profile.fields;
  const fields = value
    .filter((field): field is string => typeof field === 'string')
    .map((field) => field.trim())
    .filter((field) => /^[a-zA-Z0-9_.:-]{1,64}$/.test(field));
  return fields.length ? Array.from(new Set(fields)).slice(0, 30) : DEFAULT_ACCOUNT_CENTER_CONFIG.profile.fields;
}

function asEditMode(value: unknown): AccountCenterConfig['profile']['edit_mode'] {
  return value === 'disabled' || value === 'editable' || value === 'read_only' ? value : 'read_only';
}

function asSafeUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function sanitizeAccountCenterConfig(config: unknown): AccountCenterConfig {
  const row = isRecord(config) ? config : {};
  const value = isRecord(row.value) ? row.value : row;
  const profile = isRecord(value.profile) ? value.profile : {};
  const security = isRecord(value.security) ? value.security : {};
  const deleteAccount = isRecord(value.delete_account) ? value.delete_account : {};

  return {
    enabled: asBoolean(row.enabled, asBoolean(value.enabled, DEFAULT_ACCOUNT_CENTER_CONFIG.enabled)),
    profile: {
      edit_mode: asEditMode(profile.edit_mode),
      fields: asSafeFields(profile.fields),
    },
    security: {
      password_change: asBoolean(security.password_change, DEFAULT_ACCOUNT_CENTER_CONFIG.security.password_change),
      mfa: asBoolean(security.mfa, DEFAULT_ACCOUNT_CENTER_CONFIG.security.mfa),
      passkeys: asBoolean(security.passkeys, DEFAULT_ACCOUNT_CENTER_CONFIG.security.passkeys),
      email_change: asBoolean(security.email_change, DEFAULT_ACCOUNT_CENTER_CONFIG.security.email_change),
      phone_change: asBoolean(security.phone_change, DEFAULT_ACCOUNT_CENTER_CONFIG.security.phone_change),
    },
    sessions: { enabled: asModuleEnabled(value.sessions, DEFAULT_ACCOUNT_CENTER_CONFIG.sessions.enabled) },
    grants: { enabled: asModuleEnabled(value.grants, DEFAULT_ACCOUNT_CENTER_CONFIG.grants.enabled) },
    identities: { enabled: asModuleEnabled(value.identities, DEFAULT_ACCOUNT_CENTER_CONFIG.identities.enabled) },
    delete_account: {
      enabled: asBoolean(deleteAccount.enabled, typeof value.delete_account_url === 'string' && !!value.delete_account_url.trim()),
      url: asSafeUrl(deleteAccount.url) || asSafeUrl(value.delete_account_url),
    },
  };
}

function bearerToken(headers: Record<string, string | undefined>): string | null {
  const authHeader = headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function buildGoTrueApiUrl(baseUrl: string, routePath: string) {
  const base = new URL(baseUrl);
  base.pathname = base.pathname.replace(/\/+$/, '');
  if (!base.pathname.endsWith('/auth/v1')) {
    base.pathname = `${base.pathname}/auth/v1`.replace(/\/+/g, '/');
  }
  const normalizedPath = routePath.startsWith('/') ? routePath : `/${routePath}`;
  base.pathname = `${base.pathname}${normalizedPath}`.replace(/\/+/g, '/');
  base.search = '';
  base.hash = '';
  return base.toString();
}

function goTrueBaseCandidates(runtimeBaseUrls?: string[]) {
  if (runtimeBaseUrls?.length) return runtimeBaseUrls;
  const config = getConfig();
  const values = [config.publicBaseUrl, config.oauthRuntimeInternalUrl, config.oauthRuntimeUrl].filter(Boolean);
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.replace(/\/+$/, '');
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

async function readJson(response: Response) {
  const text = await response.text().catch(() => '');
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function accountUnavailable(message = 'Authentication runtime is unavailable.'): AccountFailure {
  return { ok: false, status: 502, code: 'runtime_unavailable', message };
}

function invalidToken(): AccountFailure {
  return { ok: false, status: 401, code: 'invalid_token', message: 'The account access token is invalid or expired.' };
}

function notFound(code: string, message: string): AccountFailure {
  return { ok: false, status: 404, code, message };
}

function forbidden(code: string, message: string): AccountFailure {
  return { ok: false, status: 403, code, message };
}

function sanitizeUser(user: Record<string, unknown>) {
  return {
    id: user.id,
    aud: user.aud,
    role: user.role,
    email: user.email,
    phone: user.phone,
    email_confirmed_at: user.email_confirmed_at,
    phone_confirmed_at: user.phone_confirmed_at,
    last_sign_in_at: user.last_sign_in_at,
    created_at: user.created_at,
    updated_at: user.updated_at,
    user_metadata: isRecord(user.user_metadata) ? user.user_metadata : {},
    app_metadata: isRecord(user.app_metadata) ? user.app_metadata : {},
    identities: Array.isArray(user.identities) ? user.identities : [],
  };
}

function isPrimitiveProfileValue(value: unknown) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function normalizeProfileData(body: unknown): Record<string, unknown> | AccountFailure {
  const input = isRecord(body) ? body : {};
  const source = isRecord(input.data)
    ? input.data
    : isRecord(input.user_metadata)
      ? input.user_metadata
      : input;
  const data: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (BLOCKED_PROFILE_KEYS.has(key)) continue;
    if (!/^[a-zA-Z0-9_.:-]{1,64}$/.test(key)) continue;
    if (!isPrimitiveProfileValue(value)) continue;
    if (typeof value === 'string' && value.length > 1000) continue;
    data[key] = value;
  }

  if (Object.keys(data).length === 0) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_profile_data',
      message: 'Provide at least one safe profile metadata field.',
    };
  }

  if (Object.keys(data).length > 30) {
    return {
      ok: false,
      status: 400,
      code: 'profile_data_too_large',
      message: 'Profile metadata contains too many fields.',
    };
  }

  return data;
}

function isFailure(value: unknown): value is AccountFailure {
  return isRecord(value) && 'ok' in value && value.ok === false;
}

function userIdFromUser(user: Record<string, unknown>): string | null {
  return typeof user.id === 'string' && user.id ? user.id : null;
}

function normalizeEmail(body: unknown): string | AccountFailure {
  const input = isRecord(body) ? body : {};
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_email',
      message: 'Provide a valid email address.',
    };
  }
  return email;
}

function normalizePhone(body: unknown): string | AccountFailure {
  const input = isRecord(body) ? body : {};
  const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
  if (!/^\+?[0-9 ()-]{6,32}$/.test(phone)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_phone',
      message: 'Provide a valid phone number.',
    };
  }
  return phone;
}

function normalizeName(body: unknown): string | AccountFailure {
  const input = isRecord(body) ? body : {};
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 80) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_name',
      message: 'Provide a passkey name up to 80 characters.',
    };
  }
  return name;
}

function passkeyIdFrom(value: unknown) {
  if (!isRecord(value)) return '';
  const id = value.id || value.passkey_id || value.credential_id;
  return typeof id === 'string' ? id : '';
}

function currentUserPasskey(items: unknown[], passkeyId: string) {
  return items.find((item) => passkeyIdFrom(item) === passkeyId) || null;
}

function mfaFactorsFromUser(user: Record<string, unknown>) {
  const candidates = [user.factors, user.mfa_factors];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  const appMetadata = isRecord(user.app_metadata) ? user.app_metadata : {};
  if (Array.isArray(appMetadata.mfa_factors)) return appMetadata.mfa_factors;
  return [];
}

function toListResponse(value: unknown): ListResult {
  if (Array.isArray(value)) return { items: value, total: value.length };
  if (isRecord(value) && Array.isArray(value.items)) {
    const items = value.items;
    return { items, total: typeof value.total === 'number' ? value.total : items.length };
  }
  return { items: [], total: 0 };
}

async function auditProfileUpdate(user: Record<string, unknown>, keys: string[]) {
  const userId = typeof user.id === 'string' ? user.id : undefined;
  if (!userId) return;

  try {
    await auditRepo.logAudit({
      eventType: 'my_account.profile.updated',
      actorId: userId,
      actorType: 'user',
      resourceType: 'user',
      resourceId: userId,
      details: { fields: keys },
    });
  } catch {}
}

async function auditAccountEvent(eventType: string, userId: string, details?: Record<string, unknown>) {
  try {
    await auditRepo.logAudit({
      eventType,
      actorId: userId,
      actorType: 'user',
      resourceType: 'user',
      resourceId: userId,
      details,
    });
  } catch {}
}

export async function getAccountWithGoTrue(
  accessToken: string,
  options: {
    fetchImpl?: typeof fetch;
    runtimeBaseUrls?: string[];
  } = {},
): Promise<AccountResult> {
  const fetchImpl = options.fetchImpl || fetch;
  const bases = goTrueBaseCandidates(options.runtimeBaseUrls);
  if (bases.length === 0) return accountUnavailable('Authentication runtime is not configured.');

  let lastError: unknown = null;
  for (const base of bases) {
    try {
      const response = await fetchImpl(buildGoTrueApiUrl(base, '/user'), {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(5000),
      });
      const payload = await readJson(response);
      if (response.status === 401 || response.status === 403) return invalidToken();
      if (!response.ok || !isRecord(payload)) {
        return {
          ok: false,
          status: response.status,
          code: 'account_lookup_failed',
          message: typeof payload?.message === 'string' ? payload.message : 'Account lookup failed.',
        };
      }
      return { ok: true, user: sanitizeUser(payload) };
    } catch (error) {
      lastError = error;
    }
  }

  return accountUnavailable(lastError instanceof Error ? lastError.message : undefined);
}

export async function updateAccountProfileWithGoTrue(
  accessToken: string,
  data: Record<string, unknown>,
  options: {
    fetchImpl?: typeof fetch;
    runtimeBaseUrls?: string[];
    audit?: boolean;
  } = {},
): Promise<AccountResult> {
  const fetchImpl = options.fetchImpl || fetch;
  const bases = goTrueBaseCandidates(options.runtimeBaseUrls);
  if (bases.length === 0) return accountUnavailable('Authentication runtime is not configured.');

  let lastError: unknown = null;
  for (const base of bases) {
    try {
      const response = await fetchImpl(buildGoTrueApiUrl(base, '/user'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ data }),
        signal: AbortSignal.timeout(5000),
      });
      const payload = await readJson(response);
      if (response.status === 401 || response.status === 403) return invalidToken();
      if (!response.ok || !isRecord(payload)) {
        return {
          ok: false,
          status: response.status,
          code: 'profile_update_failed',
          message: typeof payload?.message === 'string' ? payload.message : 'Profile update failed.',
        };
      }
      const user = sanitizeUser(payload);
      if (options.audit !== false) {
        await auditProfileUpdate(user, Object.keys(data));
      }
      return { ok: true, user };
    } catch (error) {
      lastError = error;
    }
  }

  return accountUnavailable(lastError instanceof Error ? lastError.message : undefined);
}

export async function updateAccountContactWithGoTrue(
  accessToken: string,
  data: { email?: string; phone?: string },
  options: {
    fetchImpl?: typeof fetch;
    runtimeBaseUrls?: string[];
  } = {},
): Promise<AccountResult> {
  const fetchImpl = options.fetchImpl || fetch;
  const bases = goTrueBaseCandidates(options.runtimeBaseUrls);
  if (bases.length === 0) return accountUnavailable('Authentication runtime is not configured.');

  let lastError: unknown = null;
  for (const base of bases) {
    try {
      const response = await fetchImpl(buildGoTrueApiUrl(base, '/user'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(5000),
      });
      const payload = await readJson(response);
      if (response.status === 401 || response.status === 403) return invalidToken();
      if (!response.ok || !isRecord(payload)) {
        return {
          ok: false,
          status: response.status,
          code: 'contact_update_failed',
          message: typeof payload?.message === 'string' ? payload.message : 'Contact update failed.',
        };
      }
      return { ok: true, user: sanitizeUser(payload) };
    } catch (error) {
      lastError = error;
    }
  }

  return accountUnavailable(lastError instanceof Error ? lastError.message : undefined);
}

async function listCurrentUserSessions(userId: string) {
  return toListResponse(await adapter.listUserSessions(userId));
}

async function revokeCurrentUserSession(userId: string, sessionId: string) {
  const result = await adapter.revokeUserSession(userId, sessionId);
  await auditAccountEvent('my_account.session.revoked', userId, { session_id: sessionId });
  return result;
}

async function listCurrentUserGrants(userId: string) {
  return toListResponse(await consentRepo.listUserConsents(userId));
}

async function revokeCurrentUserGrant(userId: string, consentId: string) {
  const grants = await consentRepo.listUserConsents(userId);
  if (!grants.some((grant) => grant.id === consentId)) {
    return notFound('grant_not_found', 'Grant was not found for the current account.');
  }
  const result = await consentRepo.revokeConsent(consentId);
  await auditAccountEvent('my_account.grant.revoked', userId, { consent_id: consentId });
  return result;
}

async function unlinkCurrentUserIdentity(userId: string, identityId: string) {
  const result = await adapter.unlinkUserIdentity(userId, identityId);
  await auditAccountEvent('my_account.identity.unlinked', userId, { identity_id: identityId });
  return result;
}

async function readAccountCenterConfig() {
  const config = await tenantConfigRepo.getTenantConfig('account_center', 'default');
  return sanitizeAccountCenterConfig(config || {});
}

async function listCurrentUserPasskeys(userId: string) {
  return toListResponse(await adapter.listUserPasskeys(userId));
}

async function renameCurrentUserPasskey(userId: string, passkeyId: string, name: string) {
  const passkeys = await listCurrentUserPasskeys(userId);
  if (!currentUserPasskey(passkeys.items, passkeyId)) {
    return notFound('passkey_not_found', 'Passkey was not found for the current account.');
  }
  const result = await adapter.renamePasskey(passkeyId, { name });
  await auditAccountEvent('my_account.passkey.renamed', userId, { passkey_id: passkeyId });
  return result;
}

async function revokeCurrentUserPasskey(userId: string, passkeyId: string) {
  const passkeys = await listCurrentUserPasskeys(userId);
  if (!currentUserPasskey(passkeys.items, passkeyId)) {
    return notFound('passkey_not_found', 'Passkey was not found for the current account.');
  }
  const result = await adapter.revokePasskey(passkeyId);
  await auditAccountEvent('my_account.passkey.revoked', userId, { passkey_id: passkeyId });
  return result;
}

async function resetCurrentUserMfa(userId: string, factorId: string) {
  const result = await adapter.resetUserMfa(userId, factorId);
  await auditAccountEvent('my_account.mfa.reset', userId, { factor_id: factorId });
  return result;
}

async function deleteCurrentUserAccount(userId: string) {
  const result = await adapter.deleteUser(userId);
  await auditAccountEvent('my_account.deleted', userId);
  return result;
}

export function createPublicAccountRoutes(options?: {
  getAccount?: (accessToken: string) => Promise<AccountResult>;
  updateProfile?: (accessToken: string, data: Record<string, unknown>) => Promise<AccountResult>;
  updateContact?: (accessToken: string, data: { email?: string; phone?: string }) => Promise<AccountResult>;
  getConfig?: () => Promise<AccountCenterConfig>;
  listSessions?: (userId: string) => Promise<ListResult>;
  revokeSession?: (userId: string, sessionId: string) => Promise<unknown>;
  listGrants?: (userId: string) => Promise<ListResult>;
  revokeGrant?: (userId: string, consentId: string) => Promise<unknown | AccountFailure>;
  unlinkIdentity?: (userId: string, identityId: string) => Promise<unknown>;
  listPasskeys?: (userId: string) => Promise<ListResult>;
  renamePasskey?: (userId: string, passkeyId: string, name: string) => Promise<unknown | AccountFailure>;
  revokePasskey?: (userId: string, passkeyId: string) => Promise<unknown | AccountFailure>;
  resetMfa?: (userId: string, factorId: string) => Promise<unknown>;
  deleteAccount?: (userId: string) => Promise<unknown>;
  auditEvent?: (eventType: string, userId: string, details?: Record<string, unknown>) => Promise<void>;
}) {
  const getAccount = options?.getAccount || getAccountWithGoTrue;
  const updateProfile = options?.updateProfile || updateAccountProfileWithGoTrue;
  const updateContact = options?.updateContact || updateAccountContactWithGoTrue;
  const getPublicConfig = options?.getConfig || readAccountCenterConfig;
  const listSessions = options?.listSessions || listCurrentUserSessions;
  const revokeSession = options?.revokeSession || revokeCurrentUserSession;
  const listGrants = options?.listGrants || listCurrentUserGrants;
  const revokeGrant = options?.revokeGrant || revokeCurrentUserGrant;
  const unlinkIdentity = options?.unlinkIdentity || unlinkCurrentUserIdentity;
  const listPasskeys = options?.listPasskeys || listCurrentUserPasskeys;
  const renamePasskey = options?.renamePasskey || renameCurrentUserPasskey;
  const revokePasskey = options?.revokePasskey || revokeCurrentUserPasskey;
  const resetMfa = options?.resetMfa || resetCurrentUserMfa;
  const deleteAccount = options?.deleteAccount || deleteCurrentUserAccount;
  const auditEvent = options?.auditEvent || auditAccountEvent;

  async function requireAccount(headers: Record<string, string | undefined>, set: { status?: unknown }) {
    const token = bearerToken(headers);
    if (!token) {
      set.status = 401;
      return { ok: false as const, response: { success: false, error: { code: 'missing_token', message: 'Bearer access token is required.' } } };
    }

    const account = await getAccount(token);
    if (!account.ok) {
      set.status = account.status;
      return { ok: false as const, response: { success: false, error: { code: account.code, message: account.message } } };
    }

    const userId = userIdFromUser(account.user);
    if (!userId) {
      set.status = 401;
      return { ok: false as const, response: { success: false, error: { code: 'invalid_token', message: 'The account access token has no user id.' } } };
    }

    return { ok: true as const, token, user: account.user, userId };
  }

  async function requireFeature(
    set: { status?: unknown },
    predicate: (config: AccountCenterConfig) => boolean,
    code: string,
    message: string,
  ) {
    const config = await getPublicConfig();
    const failure = !config.enabled
      ? forbidden('account_center_disabled', 'Account center is disabled.')
      : !predicate(config)
        ? forbidden(code, message)
        : null;
    if (failure) {
      set.status = failure.status;
      return { ok: false as const, response: { success: false, error: { code: failure.code, message: failure.message } } };
    }
    return { ok: true as const, config };
  }

  return new Elysia({ prefix: '/v1/public/account' })
    .get('/config', async () => {
      return { success: true, config: await getPublicConfig() };
    }, {
      detail: { summary: 'Get public account center configuration', tags: ['Public', 'Account Center'] },
    })
    .get('/me', async ({ headers, set }) => {
      const account = await requireAccount(headers as Record<string, string | undefined>, set);
      if (!account.ok) return account.response;
      const feature = await requireFeature(set, () => true, 'account_center_disabled', 'Account center is disabled.');
      if (!feature.ok) return feature.response;
      return { success: true, user: account.user };
    }, {
      detail: { summary: 'Get current account profile with user access token', tags: ['Public', 'Account Center'] },
    })
    .patch('/profile', async ({ headers, body, set }) => {
      const account = await requireAccount(headers as Record<string, string | undefined>, set);
      if (!account.ok) return account.response;
      const feature = await requireFeature(
        set,
        (config) => config.profile.edit_mode === 'editable',
        'profile_edit_disabled',
        'Profile editing is disabled for this account center.',
      );
      if (!feature.ok) return feature.response;

      const data = normalizeProfileData(body);
      if (isFailure(data)) {
        set.status = data.status;
        return { success: false, error: { code: data.code, message: data.message } };
      }

      const result = await updateProfile(account.token, data);
      if (!result.ok) {
        set.status = result.status;
        return { success: false, error: { code: result.code, message: result.message } };
      }
      return { success: true, user: result.user };
    }, {
      detail: { summary: 'Update current account profile metadata with user access token', tags: ['Public', 'Account Center'] },
    })
    .patch('/email', async ({ headers, body, set }) => {
      const account = await requireAccount(headers as Record<string, string | undefined>, set);
      if (!account.ok) return account.response;
      const feature = await requireFeature(
        set,
        (config) => config.security.email_change,
        'email_change_disabled',
        'Email change is disabled for this account center.',
      );
      if (!feature.ok) return feature.response;
      const email = normalizeEmail(body);
      if (isFailure(email as AccountFailure)) {
        const failure = email as AccountFailure;
        set.status = failure.status;
        return { success: false, error: { code: failure.code, message: failure.message } };
      }
      const result = await updateContact(account.token, { email: email as string });
      if (!result.ok) {
        set.status = result.status;
        return { success: false, error: { code: result.code, message: result.message } };
      }
      await auditEvent('my_account.email.change_requested', account.userId);
      return { success: true, user: result.user, status: 'verification_required' };
    }, {
      detail: { summary: 'Request current account email change with user access token', tags: ['Public', 'Account Center'] },
    })
    .patch('/phone', async ({ headers, body, set }) => {
      const account = await requireAccount(headers as Record<string, string | undefined>, set);
      if (!account.ok) return account.response;
      const feature = await requireFeature(
        set,
        (config) => config.security.phone_change,
        'phone_change_disabled',
        'Phone change is disabled for this account center.',
      );
      if (!feature.ok) return feature.response;
      const phone = normalizePhone(body);
      if (isFailure(phone as AccountFailure)) {
        const failure = phone as AccountFailure;
        set.status = failure.status;
        return { success: false, error: { code: failure.code, message: failure.message } };
      }
      const result = await updateContact(account.token, { phone: phone as string });
      if (!result.ok) {
        set.status = result.status;
        return { success: false, error: { code: result.code, message: result.message } };
      }
      await auditEvent('my_account.phone.change_requested', account.userId);
      return { success: true, user: result.user, status: 'verification_required' };
    }, {
      detail: { summary: 'Request current account phone change with user access token', tags: ['Public', 'Account Center'] },
    })
    .get('/sessions', async ({ headers, set }) => {
      const account = await requireAccount(headers as Record<string, string | undefined>, set);
      if (!account.ok) return account.response;
      const feature = await requireFeature(
        set,
        (config) => config.sessions.enabled,
        'sessions_disabled',
        'Session management is disabled for this account center.',
      );
      if (!feature.ok) return feature.response;
      return { success: true, ...(await listSessions(account.userId)) };
    }, {
      detail: { summary: 'List current account sessions with user access token', tags: ['Public', 'Account Center'] },
    })
    .post('/sessions/:sessionId/revoke', async ({ headers, params, set }) => {
      const account = await requireAccount(headers as Record<string, string | undefined>, set);
      if (!account.ok) return account.response;
      const feature = await requireFeature(
        set,
        (config) => config.sessions.enabled,
        'sessions_disabled',
        'Session management is disabled for this account center.',
      );
      if (!feature.ok) return feature.response;
      return { success: true, result: await revokeSession(account.userId, params.sessionId) };
    }, {
      detail: { summary: 'Revoke current account session with user access token', tags: ['Public', 'Account Center'] },
    })
    .get('/grants', async ({ headers, set }) => {
      const account = await requireAccount(headers as Record<string, string | undefined>, set);
      if (!account.ok) return account.response;
      const feature = await requireFeature(
        set,
        (config) => config.grants.enabled,
        'grants_disabled',
        'Application grants management is disabled for this account center.',
      );
      if (!feature.ok) return feature.response;
      return { success: true, ...(await listGrants(account.userId)) };
    }, {
      detail: { summary: 'List current account application grants with user access token', tags: ['Public', 'Account Center'] },
    })
    .delete('/grants/:consentId', async ({ headers, params, set }) => {
      const account = await requireAccount(headers as Record<string, string | undefined>, set);
      if (!account.ok) return account.response;
      const feature = await requireFeature(
        set,
        (config) => config.grants.enabled,
        'grants_disabled',
        'Application grants management is disabled for this account center.',
      );
      if (!feature.ok) return feature.response;
      const result = await revokeGrant(account.userId, params.consentId);
      if (isFailure(result as AccountFailure)) {
        const failure = result as AccountFailure;
        set.status = failure.status;
        return { success: false, error: { code: failure.code, message: failure.message } };
      }
      return { success: true, result };
    }, {
      detail: { summary: 'Revoke current account application grant with user access token', tags: ['Public', 'Account Center'] },
    })
    .get('/identities', async ({ headers, set }) => {
      const account = await requireAccount(headers as Record<string, string | undefined>, set);
      if (!account.ok) return account.response;
      const feature = await requireFeature(
        set,
        (config) => config.identities.enabled,
        'identities_disabled',
        'Identity management is disabled for this account center.',
      );
      if (!feature.ok) return feature.response;
      const items = Array.isArray(account.user.identities) ? account.user.identities : [];
      return { success: true, items, total: items.length };
    }, {
      detail: { summary: 'List current account identities with user access token', tags: ['Public', 'Account Center'] },
    })
    .delete('/identities/:identityId', async ({ headers, params, set }) => {
      const account = await requireAccount(headers as Record<string, string | undefined>, set);
      if (!account.ok) return account.response;
      const feature = await requireFeature(
        set,
        (config) => config.identities.enabled,
        'identities_disabled',
        'Identity management is disabled for this account center.',
      );
      if (!feature.ok) return feature.response;
      return { success: true, result: await unlinkIdentity(account.userId, params.identityId) };
    }, {
      detail: { summary: 'Unlink current account identity with user access token', tags: ['Public', 'Account Center'] },
    })
    .get('/passkeys', async ({ headers, set }) => {
      const account = await requireAccount(headers as Record<string, string | undefined>, set);
      if (!account.ok) return account.response;
      const feature = await requireFeature(
        set,
        (config) => config.security.passkeys,
        'passkeys_disabled',
        'Passkey management is disabled for this account center.',
      );
      if (!feature.ok) return feature.response;
      return { success: true, ...(await listPasskeys(account.userId)) };
    }, {
      detail: { summary: 'List current account passkeys with user access token', tags: ['Public', 'Account Center'] },
    })
    .post('/passkeys/register', async ({ headers, set }) => {
      const account = await requireAccount(headers as Record<string, string | undefined>, set);
      if (!account.ok) return account.response;
      const feature = await requireFeature(
        set,
        (config) => config.security.passkeys,
        'passkeys_disabled',
        'Passkey management is disabled for this account center.',
      );
      if (!feature.ok) return feature.response;
      set.status = 501;
      return {
        success: false,
        error: {
          code: 'passkey_registration_unsupported',
          message: 'Passkey registration requires a WebAuthn ceremony endpoint and is not enabled for this hosted account center yet.',
        },
      };
    }, {
      detail: { summary: 'Passkey registration placeholder for account center', tags: ['Public', 'Account Center'] },
    })
    .put('/passkeys/:passkeyId/rename', async ({ headers, params, body, set }) => {
      const account = await requireAccount(headers as Record<string, string | undefined>, set);
      if (!account.ok) return account.response;
      const feature = await requireFeature(
        set,
        (config) => config.security.passkeys,
        'passkeys_disabled',
        'Passkey management is disabled for this account center.',
      );
      if (!feature.ok) return feature.response;
      const name = normalizeName(body);
      if (isFailure(name as AccountFailure)) {
        const failure = name as AccountFailure;
        set.status = failure.status;
        return { success: false, error: { code: failure.code, message: failure.message } };
      }
      const result = await renamePasskey(account.userId, params.passkeyId, name as string);
      if (isFailure(result as AccountFailure)) {
        const failure = result as AccountFailure;
        set.status = failure.status;
        return { success: false, error: { code: failure.code, message: failure.message } };
      }
      return { success: true, result };
    }, {
      detail: { summary: 'Rename current account passkey with user access token', tags: ['Public', 'Account Center'] },
    })
    .delete('/passkeys/:passkeyId', async ({ headers, params, set }) => {
      const account = await requireAccount(headers as Record<string, string | undefined>, set);
      if (!account.ok) return account.response;
      const feature = await requireFeature(
        set,
        (config) => config.security.passkeys,
        'passkeys_disabled',
        'Passkey management is disabled for this account center.',
      );
      if (!feature.ok) return feature.response;
      const result = await revokePasskey(account.userId, params.passkeyId);
      if (isFailure(result as AccountFailure)) {
        const failure = result as AccountFailure;
        set.status = failure.status;
        return { success: false, error: { code: failure.code, message: failure.message } };
      }
      return { success: true, result };
    }, {
      detail: { summary: 'Revoke current account passkey with user access token', tags: ['Public', 'Account Center'] },
    })
    .get('/mfa', async ({ headers, set }) => {
      const account = await requireAccount(headers as Record<string, string | undefined>, set);
      if (!account.ok) return account.response;
      const feature = await requireFeature(
        set,
        (config) => config.security.mfa,
        'mfa_disabled',
        'MFA management is disabled for this account center.',
      );
      if (!feature.ok) return feature.response;
      const items = mfaFactorsFromUser(account.user);
      return { success: true, items, total: items.length };
    }, {
      detail: { summary: 'List current account MFA factors with user access token', tags: ['Public', 'Account Center'] },
    })
    .post('/mfa/:factorId/reset', async ({ headers, params, set }) => {
      const account = await requireAccount(headers as Record<string, string | undefined>, set);
      if (!account.ok) return account.response;
      const feature = await requireFeature(
        set,
        (config) => config.security.mfa,
        'mfa_disabled',
        'MFA management is disabled for this account center.',
      );
      if (!feature.ok) return feature.response;
      return { success: true, result: await resetMfa(account.userId, params.factorId) };
    }, {
      detail: { summary: 'Reset current account MFA factor with user access token', tags: ['Public', 'Account Center'] },
    })
    .delete('/', async ({ headers, body, set }) => {
      const account = await requireAccount(headers as Record<string, string | undefined>, set);
      if (!account.ok) return account.response;
      const feature = await requireFeature(
        set,
        (config) => config.delete_account.enabled,
        'delete_account_disabled',
        'Account deletion is disabled for this account center.',
      );
      if (!feature.ok) return feature.response;
      const input = isRecord(body) ? body : {};
      if (input.confirmation !== 'DELETE') {
        set.status = 400;
        return {
          success: false,
          error: {
            code: 'delete_confirmation_required',
            message: 'Type DELETE to confirm account deletion.',
          },
        };
      }
      return { success: true, result: await deleteAccount(account.userId), status: 'deleted' };
    }, {
      detail: { summary: 'Delete current account with user access token', tags: ['Public', 'Account Center'] },
    });
}

export const publicAccountRoutes = createPublicAccountRoutes();
