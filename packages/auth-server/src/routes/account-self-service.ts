// Public JWT-authenticated account center routes.
// These routes trust only the user's GoTrue access token and never accept
// browser-supplied user ids or service-role credentials.

import { Elysia } from 'elysia';
import { getConfig } from '../config/index.js';
import * as auditRepo from '../repositories/audit.js';
import * as tenantConfigRepo from '../repositories/tenant-config.js';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import { capabilityUnavailable } from '../utils/api-contract.js';

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

type ListOperationResult = { ok: true; items: unknown[]; total: number } | AccountFailure;
type MfaOperationResult = { ok: true; data: Record<string, unknown> } | AccountFailure;
type LogoutScope = 'local' | 'global' | 'others';
type GoTruePayloadResult = { ok: true; payload: unknown } | AccountFailure;
type AccessTokenApplicationResult = { ok: true; clientId: string | null } | AccountFailure;

export interface ProviderLinkingCapability {
  available: boolean;
  source: 'gotrue';
  version: string | null;
  reason_code: string | null;
  providers: string[];
  redirect_to: string | null;
}

interface ProviderLinkRequest {
  provider: string;
  redirectTo: string;
}

type AccountCenterConfig = {
  enabled: boolean;
  profile: {
    edit_mode: 'disabled' | 'read_only' | 'editable';
    fields: string[];
  };
  security: {
    password_change: boolean;
    mfa: boolean;
    email_change: boolean;
    phone_change: boolean;
  };
  grants: { enabled: boolean };
  identities: { enabled: boolean };
  delete_account: { enabled: boolean; url: string | null };
};

const adapter = getSupaCloudAdapter();

const NON_OAUTH_PROVIDER_CONFIG_NAMES = new Set(['anonymous_users', 'email', 'phone']);
const OAUTH_PROVIDER_NAME_PATTERN = /^(?:[a-z][a-z0-9_]{0,63}|custom:[a-z0-9][a-z0-9_-]{0,63})$/;

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
    email_change: false,
    phone_change: false,
  },
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

function unavailableProviderLinking(reasonCode: string): ProviderLinkingCapability {
  return {
    available: false,
    source: 'gotrue',
    version: null,
    reason_code: reasonCode,
    providers: [],
    redirect_to: null,
  };
}

function enabledOAuthProviders(authConfig: Record<string, unknown>) {
  const providers = Object.entries(authConfig).flatMap(([key, enabled]) => {
    const match = key.match(/^external_(.+)_enabled$/);
    if (enabled !== true || !match) return [];
    const provider = match[1];
    if (NON_OAUTH_PROVIDER_CONFIG_NAMES.has(provider) || !OAUTH_PROVIDER_NAME_PATTERN.test(provider)) return [];
    return [provider];
  });
  return Array.from(new Set(providers)).sort();
}

function accountCenterRedirect(publicBaseUrl: string) {
  try {
    const base = new URL(publicBaseUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) return null;
    return new URL('/account', base).toString();
  } catch {
    return null;
  }
}

export function resolveProviderLinkingCapability(
  authConfig: Record<string, unknown>,
  publicBaseUrl: string,
): ProviderLinkingCapability {
  // v2.193 linking-domain groups affect automatic email matching; GoTrue gates this manual ceremony separately.
  if (authConfig.manual_linking_enabled !== true) return unavailableProviderLinking('manual_linking_disabled');

  const providers = enabledOAuthProviders(authConfig);
  if (providers.length === 0) return unavailableProviderLinking('oauth_provider_unavailable');

  const redirectTo = accountCenterRedirect(publicBaseUrl);
  if (!redirectTo) return unavailableProviderLinking('account_redirect_unavailable');

  return {
    available: true,
    source: 'gotrue',
    version: null,
    reason_code: null,
    providers,
    redirect_to: redirectTo,
  };
}

async function readProviderLinkingCapability(): Promise<ProviderLinkingCapability> {
  try {
    const authConfig = await adapter.getAuthConfig();
    if (!isRecord(authConfig)) return unavailableProviderLinking('invalid_auth_config');
    return resolveProviderLinkingCapability(authConfig, getConfig().publicBaseUrl);
  } catch {
    return unavailableProviderLinking('auth_config_unavailable');
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
      email_change: asBoolean(security.email_change, DEFAULT_ACCOUNT_CENTER_CONFIG.security.email_change),
      phone_change: asBoolean(security.phone_change, DEFAULT_ACCOUNT_CENTER_CONFIG.security.phone_change),
    },
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

function decodedJwtPayload(encodedPayload: string): Record<string, unknown> | null {
  try {
    const parsedPayload: unknown = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    return isRecord(parsedPayload) ? parsedPayload : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function accessTokenApplication(accessToken: string): AccessTokenApplicationResult {
  const segments = accessToken.split('.');
  if (segments.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(segments[1])) {
    return { ok: false, status: 401, code: 'invalid_token', message: 'The account access token is not a valid JWT.' };
  }
  const tokenPayload = decodedJwtPayload(segments[1]);
  if (!tokenPayload) {
    return { ok: false, status: 401, code: 'invalid_token', message: 'The account access token payload is invalid.' };
  }
  if (tokenPayload.client_id === undefined) return { ok: true, clientId: null };
  if (typeof tokenPayload.client_id !== 'string' || !tokenPayload.client_id.trim() || tokenPayload.client_id.length > 255) {
    return { ok: false, status: 401, code: 'invalid_token', message: 'The account access token client_id is invalid.' };
  }
  return { ok: true, clientId: tokenPayload.client_id };
}

function goTrueRoute(routePath: string) {
  const separator = routePath.indexOf('?');
  return separator === -1
    ? { pathname: routePath, search: '' }
    : { pathname: routePath.slice(0, separator), search: routePath.slice(separator) };
}

function buildGoTrueApiUrl(baseUrl: string, routePath: string) {
  const base = new URL(baseUrl);
  base.pathname = base.pathname.replace(/\/+$/, '');
  if (!base.pathname.endsWith('/auth/v1')) {
    base.pathname = `${base.pathname}/auth/v1`.replace(/\/+/g, '/');
  }
  const route = goTrueRoute(routePath);
  const normalizedPath = route.pathname.startsWith('/') ? route.pathname : `/${route.pathname}`;
  base.pathname = `${base.pathname}${normalizedPath}`.replace(/\/+/g, '/');
  base.search = route.search;
  base.hash = '';
  return base.toString();
}

function buildRawGoTrueApiUrl(baseUrl: string, routePath: string) {
  const base = new URL(baseUrl);
  base.pathname = base.pathname.replace(/\/+$/, '');
  const route = goTrueRoute(routePath);
  const normalizedPath = route.pathname.startsWith('/') ? route.pathname : `/${route.pathname}`;
  base.pathname = `${base.pathname}${normalizedPath}`.replace(/\/+/g, '/');
  base.search = route.search;
  base.hash = '';
  return base.toString();
}

function normalizeBaseUrl(value?: string) {
  return value ? value.replace(/\/+$/, '') : '';
}

function shouldUseRawGoTrueFallback(baseUrl: string) {
  const base = new URL(baseUrl);
  if (base.pathname.replace(/\/+$/, '').endsWith('/auth/v1')) return false;

  const config = getConfig();
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const internalBase = normalizeBaseUrl(config.oauthRuntimeInternalUrl);
  const runtimeBase = normalizeBaseUrl(config.oauthRuntimeUrl);
  const publicBase = normalizeBaseUrl(config.publicBaseUrl);
  if (internalBase && normalizedBase === internalBase && normalizedBase !== runtimeBase && normalizedBase !== publicBase) {
    return true;
  }

  return ['127.0.0.1', '::1', 'localhost'].includes(base.hostname);
}

function goTrueRequestUrls(baseUrl: string, routePath: string) {
  const urls = [buildGoTrueApiUrl(baseUrl, routePath)];
  if (shouldUseRawGoTrueFallback(baseUrl)) urls.push(buildRawGoTrueApiUrl(baseUrl, routePath));
  return urls.filter((url, index) => urls.indexOf(url) === index);
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
    return JSON.parse(text) as unknown;
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

function normalizeLogoutScope(value: unknown): LogoutScope | AccountFailure {
  if (value === 'local' || value === 'global' || value === 'others') return value;
  return {
    ok: false,
    status: 400,
    code: 'invalid_logout_scope',
    message: 'Logout scope must be local, global, or others.',
  };
}

function invalidAccountRequest(code: string, message: string): AccountFailure {
  return { ok: false, status: 400, code, message };
}

function normalizedAccountRedirect(requestedRedirect: unknown, allowedRedirect: string | null) {
  if (typeof requestedRedirect !== 'string' || !allowedRedirect) return null;
  try {
    const requested = new URL(requestedRedirect);
    const allowed = new URL(allowedRedirect);
    const matchesAccountCenter = requested.origin === allowed.origin
      && requested.pathname === allowed.pathname
      && !requested.search
      && !requested.hash
      && !requested.username
      && !requested.password;
    return matchesAccountCenter ? allowed.toString() : null;
  } catch {
    return null;
  }
}

function normalizeProviderLinkRequest(
  body: unknown,
  capability: ProviderLinkingCapability,
): ProviderLinkRequest | AccountFailure {
  const input = isRecord(body) ? body : {};
  const provider = typeof input.provider === 'string' ? input.provider : '';
  if (!OAUTH_PROVIDER_NAME_PATTERN.test(provider) || !capability.providers.includes(provider)) {
    return invalidAccountRequest('provider_not_allowed', 'Provider is not enabled for manual identity linking.');
  }

  const redirectTo = normalizedAccountRedirect(input.redirect_to, capability.redirect_to);
  if (!redirectTo) {
    return invalidAccountRequest('invalid_redirect_to', 'redirect_to must target this account center.');
  }
  return { provider, redirectTo };
}

function normalizeTotpEnrollment(body: unknown) {
  const input = isRecord(body) ? body : {};
  const friendlyName = typeof input.friendly_name === 'string'
    ? input.friendly_name.trim()
    : typeof input.name === 'string'
      ? input.name.trim()
      : 'Authenticator app';
  const issuer = typeof input.issuer === 'string' ? input.issuer.trim() : '';

  return {
    friendly_name: friendlyName.slice(0, 80) || 'Authenticator app',
    ...(issuer && issuer.length <= 80 ? { issuer } : {}),
  };
}

function normalizeTotpCode(body: unknown): string | AccountFailure {
  const input = isRecord(body) ? body : {};
  const code = typeof input.code === 'string' ? input.code.replace(/\s+/g, '') : '';
  if (!/^\d{6,8}$/.test(code)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_mfa_code',
      message: 'Provide a valid authenticator code.',
    };
  }
  return code;
}

function challengeIdFrom(body: unknown): string | null {
  const input = isRecord(body) ? body : {};
  const challengeId = input.challenge_id || input.challengeId;
  return typeof challengeId === 'string' && challengeId.trim() ? challengeId.trim() : null;
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

function publicMfaEnrollmentPayload(payload: Record<string, unknown>) {
  const totp = isRecord(payload.totp) ? payload.totp : {};
  const factorId = payload.id || payload.factor_id;
  return {
    factor_id: typeof factorId === 'string' ? factorId : '',
    id: typeof factorId === 'string' ? factorId : '',
    type: payload.type || payload.factor_type || 'totp',
    status: payload.status || payload.factor_status || 'unverified',
    friendly_name: payload.friendly_name || payload.name || null,
    totp: {
      qr_code: typeof totp.qr_code === 'string' ? totp.qr_code : '',
      uri: typeof totp.uri === 'string' ? totp.uri : '',
    },
  };
}

function goTrueErrorMessage(payload: unknown, fallbackMessage: string) {
  if (!isRecord(payload)) return fallbackMessage;
  for (const field of ['message', 'msg', 'error_description', 'error']) {
    if (typeof payload[field] === 'string' && payload[field].trim()) return payload[field];
  }
  return fallbackMessage;
}

async function requestGoTrueWithUserToken(input: {
  accessToken: string;
  routePath: string;
  init: RequestInit;
  failureCode: string;
  fallbackMessage: string;
  fetchImpl?: typeof fetch;
  runtimeBaseUrls?: string[];
}): Promise<GoTruePayloadResult> {
  const bases = goTrueBaseCandidates(input.runtimeBaseUrls);
  if (bases.length === 0) return accountUnavailable('Authentication runtime is not configured.');

  let lastNetworkError: unknown = null;
  for (const base of bases) {
    const urls = goTrueRequestUrls(base, input.routePath);
    for (const [urlIndex, url] of urls.entries()) {
      try {
        const response = await (input.fetchImpl || fetch)(url, {
          ...input.init,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${input.accessToken}`,
            ...(input.init.headers || {}),
          },
          signal: input.init.signal || AbortSignal.timeout(5000),
        });
        const payload = await readJson(response);
        if (response.status === 401 || response.status === 403) return invalidToken();
        if (response.ok) return { ok: true, payload };
        if (response.status === 404 && urlIndex < urls.length - 1) continue;
        return {
          ok: false,
          status: response.status,
          code: input.failureCode,
          message: goTrueErrorMessage(payload, input.fallbackMessage),
        };
      } catch (error) {
        lastNetworkError = error;
      }
    }
  }

  return accountUnavailable(lastNetworkError instanceof Error ? lastNetworkError.message : undefined);
}

async function fetchGoTrueJsonWithUserToken(input: {
  accessToken: string;
  routePath: string;
  init: RequestInit;
  failureCode: string;
  fallbackMessage: string;
  fetchImpl?: typeof fetch;
  runtimeBaseUrls?: string[];
  emptySuccessData?: Record<string, unknown>;
}): Promise<MfaOperationResult> {
  const response = await requestGoTrueWithUserToken({
    accessToken: input.accessToken,
    routePath: input.routePath,
    init: input.init,
    failureCode: input.failureCode,
    fallbackMessage: input.fallbackMessage,
    fetchImpl: input.fetchImpl,
    runtimeBaseUrls: input.runtimeBaseUrls,
  });
  if (!response.ok) return response;
  if (isRecord(response.payload)) return { ok: true, data: response.payload };
  if (response.payload === null && input.emptySuccessData) {
    return { ok: true, data: input.emptySuccessData };
  }
  return {
    ok: false,
    status: 502,
    code: 'invalid_gotrue_response',
    message: 'Authentication runtime returned an invalid response.',
  };
}

async function auditProfileUpdate(user: Record<string, unknown>, keys: string[]) {
  const userId = typeof user.id === 'string' ? user.id : undefined;
  if (!userId) return;

  await auditRepo.logAudit({
    eventType: 'my_account.profile.updated',
    actorId: userId,
    actorType: 'user',
    resourceType: 'user',
    resourceId: userId,
    details: { fields: keys },
  });
}

async function auditAccountEvent(eventType: string, userId: string, details?: Record<string, unknown>) {
  await auditRepo.logAudit({
    eventType,
    actorId: userId,
    actorType: 'user',
    resourceType: 'user',
    resourceId: userId,
    details,
  });
}

export async function getAccountWithGoTrue(
  accessToken: string,
  options: {
    fetchImpl?: typeof fetch;
    runtimeBaseUrls?: string[];
  } = {},
): Promise<AccountResult> {
  const result = await fetchGoTrueJsonWithUserToken({
    accessToken,
    routePath: '/user',
    init: { method: 'GET' },
    failureCode: 'account_lookup_failed',
    fallbackMessage: 'Account lookup failed.',
    fetchImpl: options.fetchImpl,
    runtimeBaseUrls: options.runtimeBaseUrls,
  });
  if (!result.ok) return result;
  return { ok: true, user: sanitizeUser(result.data) };
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
  const result = await fetchGoTrueJsonWithUserToken({
    accessToken,
    routePath: '/user',
    init: {
      method: 'PUT',
      body: JSON.stringify({ data }),
    },
    failureCode: 'profile_update_failed',
    fallbackMessage: 'Profile update failed.',
    fetchImpl: options.fetchImpl,
    runtimeBaseUrls: options.runtimeBaseUrls,
  });
  if (!result.ok) return result;
  const user = sanitizeUser(result.data);
  if (options.audit !== false) {
    await auditProfileUpdate(user, Object.keys(data));
  }
  return { ok: true, user };
}

export async function updateAccountContactWithGoTrue(
  accessToken: string,
  data: { email?: string; phone?: string },
  options: {
    fetchImpl?: typeof fetch;
    runtimeBaseUrls?: string[];
  } = {},
): Promise<AccountResult> {
  const result = await fetchGoTrueJsonWithUserToken({
    accessToken,
    routePath: '/user',
    init: {
      method: 'PUT',
      body: JSON.stringify(data),
    },
    failureCode: 'contact_update_failed',
    fallbackMessage: 'Contact update failed.',
    ...options,
  });
  if (!result.ok) return result;
  return { ok: true, user: sanitizeUser(result.data) };
}

export async function enrollTotpMfaWithGoTrue(
  accessToken: string,
  input: { friendly_name: string; issuer?: string },
  options: {
    fetchImpl?: typeof fetch;
    runtimeBaseUrls?: string[];
  } = {},
): Promise<MfaOperationResult> {
  const result = await fetchGoTrueJsonWithUserToken({
    accessToken,
    routePath: '/factors',
    init: {
      method: 'POST',
      body: JSON.stringify({
        factor_type: 'totp',
        friendly_name: input.friendly_name,
        ...(input.issuer ? { issuer: input.issuer } : {}),
      }),
    },
    failureCode: 'mfa_enrollment_failed',
    fallbackMessage: 'MFA enrollment failed.',
    ...options,
  });
  if (!result.ok) return result;
  return { ok: true, data: publicMfaEnrollmentPayload(result.data) };
}

export async function verifyTotpMfaWithGoTrue(
  accessToken: string,
  factorId: string,
  input: { code: string; challengeId?: string | null },
  options: {
    fetchImpl?: typeof fetch;
    runtimeBaseUrls?: string[];
  } = {},
): Promise<MfaOperationResult> {
  const encodedFactorId = encodeURIComponent(factorId);
  let challengeId = input.challengeId || null;
  if (!challengeId) {
    const challenge = await fetchGoTrueJsonWithUserToken({
      accessToken,
      routePath: `/factors/${encodedFactorId}/challenge`,
      init: {
        method: 'POST',
        body: JSON.stringify({}),
      },
      failureCode: 'mfa_challenge_failed',
      fallbackMessage: 'MFA challenge failed.',
      ...options,
    });
    if (!challenge.ok) return challenge;
    const rawChallengeId = challenge.data.id || challenge.data.challenge_id;
    challengeId = typeof rawChallengeId === 'string' ? rawChallengeId : null;
    if (!challengeId) {
      return {
        ok: false,
        status: 502,
        code: 'mfa_challenge_invalid',
        message: 'MFA challenge response did not include a challenge id.',
      };
    }
  }

  return fetchGoTrueJsonWithUserToken({
    accessToken,
    routePath: `/factors/${encodedFactorId}/verify`,
    init: {
      method: 'POST',
      body: JSON.stringify({
        code: input.code,
        challenge_id: challengeId,
      }),
    },
    failureCode: 'mfa_verification_failed',
    fallbackMessage: 'MFA verification failed.',
    ...options,
  });
}

export async function unenrollMfaFactorWithGoTrue(
  accessToken: string,
  factorId: string,
  options: {
    fetchImpl?: typeof fetch;
    runtimeBaseUrls?: string[];
  } = {},
): Promise<MfaOperationResult> {
  const encodedFactorId = encodeURIComponent(factorId);
  return fetchGoTrueJsonWithUserToken({
    accessToken,
    routePath: `/factors/${encodedFactorId}`,
    init: { method: 'DELETE' },
    failureCode: 'mfa_unenroll_failed',
    fallbackMessage: 'MFA factor unenroll failed.',
    ...options,
    emptySuccessData: { id: factorId, status: 'unenrolled' },
  });
}

export async function listOAuthGrantsWithGoTrue(
  accessToken: string,
  options: { fetchImpl?: typeof fetch; runtimeBaseUrls?: string[] } = {},
): Promise<ListOperationResult> {
  const response = await requestGoTrueWithUserToken({
    accessToken,
    routePath: '/user/oauth/grants',
    init: { method: 'GET' },
    failureCode: 'oauth_grants_lookup_failed',
    fallbackMessage: 'Application grants lookup failed.',
    ...options,
  });
  if (!response.ok) return response;
  if (Array.isArray(response.payload)) {
    return { ok: true, items: response.payload, total: response.payload.length };
  }
  return {
    ok: false,
    status: 502,
    code: 'invalid_gotrue_response',
    message: 'Authentication runtime returned an invalid grants response.',
  };
}

export function revokeOAuthGrantWithGoTrue(
  accessToken: string,
  clientId: string,
  options: { fetchImpl?: typeof fetch; runtimeBaseUrls?: string[] } = {},
): Promise<MfaOperationResult> {
  return fetchGoTrueJsonWithUserToken({
    accessToken,
    routePath: `/user/oauth/grants?client_id=${encodeURIComponent(clientId)}`,
    init: { method: 'DELETE' },
    failureCode: 'oauth_grant_revoke_failed',
    fallbackMessage: 'Application grant revocation failed.',
    ...options,
    emptySuccessData: { client_id: clientId, status: 'revoked' },
  });
}

export function unlinkIdentityWithGoTrue(
  accessToken: string,
  identityId: string,
  options: { fetchImpl?: typeof fetch; runtimeBaseUrls?: string[] } = {},
): Promise<MfaOperationResult> {
  return fetchGoTrueJsonWithUserToken({
    accessToken,
    routePath: `/user/identities/${encodeURIComponent(identityId)}`,
    init: { method: 'DELETE' },
    failureCode: 'identity_unlink_failed',
    fallbackMessage: 'Identity unlink failed.',
    ...options,
  });
}

function providerAuthorizationUrl(payload: unknown) {
  if (!isRecord(payload) || typeof payload.url !== 'string') return null;
  try {
    const authorizationUrl = new URL(payload.url);
    if (!['http:', 'https:'].includes(authorizationUrl.protocol)
      || authorizationUrl.username
      || authorizationUrl.password) return null;
    return authorizationUrl.toString();
  } catch {
    return null;
  }
}

export async function authorizeIdentityLinkWithGoTrue(
  accessToken: string,
  request: ProviderLinkRequest,
  options: { fetchImpl?: typeof fetch; runtimeBaseUrls?: string[] } = {},
): Promise<MfaOperationResult> {
  const query = new URLSearchParams({
    provider: request.provider,
    redirect_to: request.redirectTo,
    skip_http_redirect: 'true',
  });
  const response = await requestGoTrueWithUserToken({
    accessToken,
    routePath: `/user/identities/authorize?${query.toString()}`,
    init: { method: 'GET', redirect: 'manual' },
    failureCode: 'identity_link_authorization_failed',
    fallbackMessage: 'Identity linking could not be started.',
    ...options,
  });
  if (!response.ok) return response;

  const url = providerAuthorizationUrl(response.payload);
  if (!url) {
    return {
      ok: false,
      status: 502,
      code: 'invalid_gotrue_response',
      message: 'Authentication runtime returned an invalid identity linking URL.',
    };
  }
  return { ok: true, data: { provider: request.provider, url } };
}

export function logoutWithGoTrue(
  accessToken: string,
  scope: LogoutScope,
  options: { fetchImpl?: typeof fetch; runtimeBaseUrls?: string[] } = {},
): Promise<MfaOperationResult> {
  return fetchGoTrueJsonWithUserToken({
    accessToken,
    routePath: `/logout?scope=${scope}`,
    init: { method: 'POST' },
    failureCode: 'logout_failed',
    fallbackMessage: 'Logout failed.',
    ...options,
    emptySuccessData: { scope, status: 'logged_out' },
  });
}

async function readAccountCenterConfig() {
  const config = await tenantConfigRepo.getTenantConfig('account_center', 'default');
  return sanitizeAccountCenterConfig(config || {});
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
  getProviderLinkingCapability?: () => Promise<ProviderLinkingCapability>;
  listGrants?: (accessToken: string) => Promise<ListOperationResult>;
  revokeGrant?: (accessToken: string, clientId: string) => Promise<MfaOperationResult>;
  authorizeIdentityLink?: (accessToken: string, request: ProviderLinkRequest) => Promise<MfaOperationResult>;
  unlinkIdentity?: (accessToken: string, identityId: string) => Promise<MfaOperationResult>;
  logout?: (accessToken: string, scope: LogoutScope) => Promise<MfaOperationResult>;
  enrollTotpMfa?: (accessToken: string, input: { friendly_name: string; issuer?: string }) => Promise<MfaOperationResult>;
  verifyTotpMfa?: (accessToken: string, factorId: string, input: { code: string; challengeId?: string | null }) => Promise<MfaOperationResult>;
  unenrollMfa?: (accessToken: string, factorId: string) => Promise<MfaOperationResult>;
  resolvePermissions?: (userId: string, orgId?: string, applicationId?: string) => Promise<unknown>;
  deleteAccount?: (userId: string) => Promise<unknown>;
  auditEvent?: (eventType: string, userId: string, details?: Record<string, unknown>) => Promise<void>;
  }) {
  const getAccount = options?.getAccount || getAccountWithGoTrue;
  const updateProfile = options?.updateProfile || updateAccountProfileWithGoTrue;
  const updateContact = options?.updateContact || updateAccountContactWithGoTrue;
  const getPublicConfig = options?.getConfig || readAccountCenterConfig;
  const getProviderLinking = options?.getProviderLinkingCapability || readProviderLinkingCapability;
  const listGrants = options?.listGrants || listOAuthGrantsWithGoTrue;
  const revokeGrant = options?.revokeGrant || revokeOAuthGrantWithGoTrue;
  const authorizeIdentityLink = options?.authorizeIdentityLink || authorizeIdentityLinkWithGoTrue;
  const unlinkIdentity = options?.unlinkIdentity || unlinkIdentityWithGoTrue;
  const logout = options?.logout || logoutWithGoTrue;
  const enrollTotpMfa = options?.enrollTotpMfa || enrollTotpMfaWithGoTrue;
  const verifyTotpMfa = options?.verifyTotpMfa || verifyTotpMfaWithGoTrue;
  const unenrollMfa = options?.unenrollMfa || unenrollMfaFactorWithGoTrue;
  const resolvePermissions = options?.resolvePermissions || ((userId: string, orgId?: string, applicationId?: string) =>
    adapter.resolveUserPermissions(userId, orgId, applicationId));
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
      const [config, providerLinking] = await Promise.all([getPublicConfig(), getProviderLinking()]);
      return {
        success: true,
        config,
        capabilities: { provider_linking: providerLinking },
      };
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
    .get('/permissions', async ({ headers, query, set }) => {
      const account = await requireAccount(headers as Record<string, string | undefined>, set);
      if (!account.ok) return account.response;
      const applicationId = typeof query.application_id === 'string' ? query.application_id.trim() : '';
      const orgId = typeof query.org_id === 'string' ? query.org_id.trim() : undefined;
      if (!applicationId || applicationId.length > 255) {
        set.status = 400;
        return {
          success: false,
          error: { code: 'application_id_required', message: 'A valid application_id is required.' },
        };
      }
      if (orgId && orgId.length > 255) {
        set.status = 400;
        return {
          success: false,
          error: { code: 'invalid_org_id', message: 'The org_id is too long.' },
        };
      }
      // Cases: ordinary session, matching OAuth client, malformed JWT payload, and cross-client query.
      const tokenApplication = accessTokenApplication(account.token);
      if (!tokenApplication.ok) {
        set.status = tokenApplication.status;
        return { success: false, error: { code: tokenApplication.code, message: tokenApplication.message } };
      }
      if (tokenApplication.clientId && tokenApplication.clientId !== applicationId) {
        set.status = 403;
        return {
          success: false,
          error: {
            code: 'application_context_mismatch',
            message: 'The access token is bound to a different application.',
          },
        };
      }
      const resolved = await resolvePermissions(account.userId, orgId || undefined, applicationId);
      return {
        ...(isRecord(resolved) ? resolved : { data: resolved }),
        success: true,
        application_id: applicationId,
      };
    }, {
      detail: { summary: 'Resolve current user permissions for one application', tags: ['Public', 'Account Center', 'RBAC'] },
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
    .get('/sessions', async () => {
      throw capabilityUnavailable('gotrue_user_session_listing');
    }, {
      detail: { hide: true },
    })
    .post('/sessions/:sessionId/revoke', async () => {
      throw capabilityUnavailable('gotrue_user_session_revoke_by_id');
    }, {
      detail: { hide: true },
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
      const grantList = await listGrants(account.token);
      if (!grantList.ok) {
        set.status = grantList.status;
        return { success: false, error: { code: grantList.code, message: grantList.message } };
      }
      return { success: true, items: grantList.items, total: grantList.total };
    }, {
      detail: { summary: 'List current account application grants with user access token', tags: ['Public', 'Account Center'] },
    })
    .delete('/grants/:clientId', async ({ headers, params, set }) => {
      const account = await requireAccount(headers as Record<string, string | undefined>, set);
      if (!account.ok) return account.response;
      const feature = await requireFeature(
        set,
        (config) => config.grants.enabled,
        'grants_disabled',
        'Application grants management is disabled for this account center.',
      );
      if (!feature.ok) return feature.response;
      const grantRevocation = await revokeGrant(account.token, params.clientId);
      if (!grantRevocation.ok) {
        set.status = grantRevocation.status;
        return { success: false, error: { code: grantRevocation.code, message: grantRevocation.message } };
      }
      await auditEvent('my_account.grant.revoked', account.userId, { client_id: params.clientId });
      return { success: true, result: grantRevocation.data };
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
    .post('/identities/authorize', async ({ headers, body, set }) => {
      const account = await requireAccount(headers as Record<string, string | undefined>, set);
      if (!account.ok) return account.response;
      const feature = await requireFeature(
        set,
        (config) => config.identities.enabled,
        'identities_disabled',
        'Identity management is disabled for this account center.',
      );
      if (!feature.ok) return feature.response;

      const capability = await getProviderLinking();
      if (!capability.available) {
        set.status = 501;
        return {
          success: false,
          error: {
            code: 'capability_unavailable',
            message: 'Manual provider linking is not enabled in GoTrue.',
            reason_code: capability.reason_code,
          },
        };
      }

      const linkRequest = normalizeProviderLinkRequest(body, capability);
      if (isFailure(linkRequest)) {
        set.status = linkRequest.status;
        return { success: false, error: { code: linkRequest.code, message: linkRequest.message } };
      }

      const authorization = await authorizeIdentityLink(account.token, linkRequest);
      if (!authorization.ok) {
        set.status = authorization.status;
        return { success: false, error: { code: authorization.code, message: authorization.message } };
      }
      return { success: true, authorization: authorization.data };
    }, {
      detail: { summary: 'Start current account manual identity linking with GoTrue', tags: ['Public', 'Account Center'] },
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
      const identityUnlink = await unlinkIdentity(account.token, params.identityId);
      if (!identityUnlink.ok) {
        set.status = identityUnlink.status;
        return { success: false, error: { code: identityUnlink.code, message: identityUnlink.message } };
      }
      await auditEvent('my_account.identity.unlinked', account.userId, { identity_id: params.identityId });
      return { success: true, result: identityUnlink.data };
    }, {
      detail: { summary: 'Unlink current account identity with user access token', tags: ['Public', 'Account Center'] },
    })
    .post('/logout', async ({ headers, query, set }) => {
      const account = await requireAccount(headers as Record<string, string | undefined>, set);
      if (!account.ok) return account.response;
      const scope = normalizeLogoutScope(query.scope);
      if (typeof scope !== 'string') {
        set.status = scope.status;
        return { success: false, error: { code: scope.code, message: scope.message } };
      }
      const logoutOperation = await logout(account.token, scope);
      if (!logoutOperation.ok) {
        set.status = logoutOperation.status;
        return { success: false, error: { code: logoutOperation.code, message: logoutOperation.message } };
      }
      await auditEvent('my_account.logged_out', account.userId, { scope });
      return { success: true, result: logoutOperation.data };
    }, {
      detail: { summary: 'Log out the current GoTrue account by scope', tags: ['Public', 'Account Center'] },
    })
    .get('/passkeys', async () => {
      throw capabilityUnavailable('gotrue_passkey_ceremony');
    }, {
      detail: { hide: true },
    })
    .put('/passkeys/:passkeyId/rename', async () => {
      throw capabilityUnavailable('gotrue_passkey_ceremony');
    }, {
      detail: { hide: true },
    })
    .delete('/passkeys/:passkeyId', async () => {
      throw capabilityUnavailable('gotrue_passkey_ceremony');
    }, {
      detail: { hide: true },
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
      .post('/mfa/totp/enroll', async ({ headers, body, set }) => {
        const account = await requireAccount(headers as Record<string, string | undefined>, set);
        if (!account.ok) return account.response;
        const feature = await requireFeature(
          set,
          (config) => config.security.mfa,
          'mfa_disabled',
          'MFA management is disabled for this account center.',
        );
        if (!feature.ok) return feature.response;
        const result = await enrollTotpMfa(account.token, normalizeTotpEnrollment(body));
        if (!result.ok) {
          set.status = result.status;
          return { success: false, error: { code: result.code, message: result.message } };
        }
        const enrollment = publicMfaEnrollmentPayload(result.data);
        await auditEvent('my_account.mfa.totp.enrolled', account.userId, { factor_id: enrollment.factor_id || null });
        return { success: true, enrollment };
      }, {
        detail: { summary: 'Enroll current account TOTP MFA factor with user access token', tags: ['Public', 'Account Center'] },
      })
      .post('/mfa/:factorId/verify', async ({ headers, params, body, set }) => {
        const account = await requireAccount(headers as Record<string, string | undefined>, set);
        if (!account.ok) return account.response;
        const feature = await requireFeature(
          set,
          (config) => config.security.mfa,
          'mfa_disabled',
          'MFA management is disabled for this account center.',
        );
        if (!feature.ok) return feature.response;
        const code = normalizeTotpCode(body);
        if (isFailure(code as AccountFailure)) {
          const failure = code as AccountFailure;
          set.status = failure.status;
          return { success: false, error: { code: failure.code, message: failure.message } };
        }
        const result = await verifyTotpMfa(account.token, params.factorId, {
          code: code as string,
          challengeId: challengeIdFrom(body),
        });
        if (!result.ok) {
          set.status = result.status;
          return { success: false, error: { code: result.code, message: result.message } };
        }
        await auditEvent('my_account.mfa.totp.verified', account.userId, { factor_id: params.factorId });
        return { success: true, result: result.data, status: 'verified' };
      }, {
        detail: { summary: 'Verify current account TOTP MFA factor with user access token', tags: ['Public', 'Account Center'] },
      })
    .delete('/mfa/:factorId', async ({ headers, params, set }) => {
      const account = await requireAccount(headers as Record<string, string | undefined>, set);
      if (!account.ok) return account.response;
      const feature = await requireFeature(
        set,
        (config) => config.security.mfa,
        'mfa_disabled',
        'MFA management is disabled for this account center.',
      );
      if (!feature.ok) return feature.response;
      const result = await unenrollMfa(account.token, params.factorId);
      if (!result.ok) {
        set.status = result.status;
        return { success: false, error: { code: result.code, message: result.message } };
      }
      await auditEvent('my_account.mfa.unenrolled', account.userId, { factor_id: params.factorId });
      return { success: true, result: result.data, status: 'unenrolled' };
    }, {
      detail: { summary: 'Unenroll current account MFA factor with user access token', tags: ['Public', 'Account Center'] },
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
