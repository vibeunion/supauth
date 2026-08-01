// Public self-service password change flow.
// The browser never receives or sends service-role credentials: the route first
// verifies the current password through GoTrue password grant, then updates the
// password with the returned user access token.

import { Elysia } from 'elysia';
import { getConfig } from '../config/index.js';
import * as auditRepo from '../repositories/audit.js';
import { getSupaCloudAdapter } from '../supacloud/adapter.js';
import {
  passwordPolicyFromAuthConfig,
  passwordPolicyViolation,
  type PasswordPolicyViolation,
  type PublicPasswordPolicy,
} from '../utils/password-policy.js';
import { BoundedFixedWindowLimiter, resolveClientIp } from '../utils/rate-limit.js';
import {
  isInvalidCredentialsResponse,
  isWeakPasswordResponse,
  preferredUpstreamNetworkFailure,
  upstreamNetworkFailure,
  upstreamResponseFailure,
  type PublicUpstreamFailure,
} from '../utils/upstream-failure.js';
import {
  readAccountCenterConfig,
  type AccountCenterConfig,
} from './account-self-service.js';

const PASSWORD_CHANGE_LIMIT_WINDOW_MS = 60_000;
const PASSWORD_CHANGE_LIMIT_MAX = 8;
const attempts = new BoundedFixedWindowLimiter({ windowMs: PASSWORD_CHANGE_LIMIT_WINDOW_MS });
const adapter = getSupaCloudAdapter();

interface PasswordChangeInput {
  email: string;
  currentPassword: string;
  newPassword: string;
}

interface PasswordChangeSuccess {
  ok: true;
  userId?: string;
}

type PasswordChangeFailure = PublicUpstreamFailure;

type PasswordChangeResult = PasswordChangeSuccess | PasswordChangeFailure;

interface RuntimeRequestOptions {
  bases: string[];
  fetchImpl: typeof fetch;
}

interface RuntimeResponseSuccess {
  ok: true;
  response: Response;
}

type RuntimeResponseResult = RuntimeResponseSuccess | PasswordChangeFailure;

interface PasswordGrantSuccess {
  ok: true;
  accessToken: string;
  tokenPayload: Record<string, unknown> | null;
}

interface PasswordUpdateSuccess {
  ok: true;
  payload: Record<string, unknown> | null;
}

interface RuntimeJsonSuccess {
  ok: true;
  payload: Record<string, unknown> | null;
}

function requestIp(headers: Record<string, string | undefined>): string {
  return resolveClientIp(headers, getConfig().trustProxyHeaders);
}

function rateLimitKey(ip: string, email: string) {
  return `${ip}:${email.toLowerCase()}`;
}

function consumeLimit(ip: string, email: string): boolean {
  const key = rateLimitKey(ip, email);
  return attempts.consume(key, PASSWORD_CHANGE_LIMIT_MAX);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function passwordChangeFailure(status: number, code: string, message: string): PasswordChangeFailure {
  return { ok: false, status, code, message };
}

function passwordViolationFailure(
  violation: PasswordPolicyViolation,
  minLength: number,
): PasswordChangeFailure {
  const messages: Record<PasswordPolicyViolation, string> = {
    password_too_short: `New password must be at least ${minLength} characters.`,
    password_requires_uppercase: 'New password must include an uppercase letter.',
    password_requires_lowercase: 'New password must include a lowercase letter.',
    password_requires_number: 'New password must include a number.',
    password_requires_symbol: 'New password must include a symbol.',
  };
  return { ok: false, status: 400, code: violation, message: messages[violation] };
}

function parsePasswordChangeInput(body: unknown): PasswordChangeInput | PasswordChangeFailure {
  const data = isRecord(body) ? body : {};
  const email = normalizeEmail(data.email);
  const currentPassword = readString(data.current_password || data.currentPassword);
  const newPassword = readString(data.new_password || data.newPassword);
  const confirmPassword = readString(data.confirm_password || data.confirmPassword);

  if (!email || !currentPassword || !newPassword) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_request',
      message: 'Email, current password, and new password are required.',
    };
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_email',
      message: 'Enter a valid email address.',
    };
  }
  if (confirmPassword && confirmPassword !== newPassword) {
    return {
      ok: false,
      status: 400,
      code: 'password_mismatch',
      message: 'New password confirmation does not match.',
    };
  }
  if (currentPassword === newPassword) {
    return {
      ok: false,
      status: 400,
      code: 'password_unchanged',
      message: 'New password must be different from the current password.',
    };
  }

  return { email, currentPassword, newPassword };
}

function passwordPolicyFailure(
  input: PasswordChangeInput,
  passwordPolicy: PublicPasswordPolicy,
): PasswordChangeFailure | null {
  const violation = passwordPolicyViolation(input.newPassword, passwordPolicy);
  return violation ? passwordViolationFailure(violation, passwordPolicy.min_length) : null;
}

function isPasswordChangeFailure(value: PasswordChangeInput | PasswordChangeFailure): value is PasswordChangeFailure {
  return 'ok' in value && value.ok === false;
}

function buildGoTrueApiUrl(baseUrl: string, path: string) {
  const base = new URL(baseUrl);
  base.pathname = base.pathname.replace(/\/+$/, '');
  if (!base.pathname.endsWith('/auth/v1')) {
    base.pathname = `${base.pathname}/auth/v1`.replace(/\/+/g, '/');
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
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
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readRuntimeJson(
  response: Response,
): Promise<RuntimeJsonSuccess | PasswordChangeFailure> {
  try {
    return { ok: true, payload: await readJson(response) };
  } catch (error) {
    return upstreamNetworkFailure(error);
  }
}

function userIdFromTokenPayload(payload: Record<string, unknown> | null): string | undefined {
  if (!payload) return undefined;
  const user = payload.user;
  if (isRecord(user) && typeof user.id === 'string') return user.id;
  return undefined;
}

function invalidCurrentPassword(): PasswordChangeFailure {
  return passwordChangeFailure(400, 'invalid_current_password', 'Current password is incorrect.');
}

function weakPassword(): PasswordChangeFailure {
  return passwordChangeFailure(400, 'weak_password', 'New password does not satisfy the current password policy.');
}

function invalidRuntimeResponse(): PasswordChangeFailure {
  return passwordChangeFailure(502, 'invalid_upstream_response', 'Authentication runtime returned an invalid response.');
}

async function auditPasswordChange(userId: string | undefined, email: string) {
  await auditRepo.logAudit({
    eventType: 'my_account.password.changed',
    actorId: userId || email,
    actorType: 'user',
    resourceType: 'user',
    resourceId: userId || email,
    details: { method: 'password' },
  });
}

async function firstRuntimeResponse(
  options: RuntimeRequestOptions,
  request: (base: string) => Promise<Response>,
): Promise<RuntimeResponseResult> {
  let lastFailure: PasswordChangeFailure | null = null;
  for (const base of options.bases) {
    try {
      return { ok: true, response: await request(base) };
    } catch (error) {
      lastFailure = preferredUpstreamNetworkFailure(lastFailure, error);
    }
  }
  return lastFailure || upstreamNetworkFailure(null);
}

async function passwordGrant(
  input: PasswordChangeInput,
  options: RuntimeRequestOptions,
): Promise<PasswordGrantSuccess | PasswordChangeFailure> {
  const runtime = await firstRuntimeResponse(options, (base) => options.fetchImpl(
    `${buildGoTrueApiUrl(base, '/token')}?grant_type=password`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: input.email, password: input.currentPassword }),
      signal: AbortSignal.timeout(5000),
    },
  ));
  if (!runtime.ok) return runtime;

  const parsed = await readRuntimeJson(runtime.response);
  if (!parsed.ok) return parsed;
  const { payload } = parsed;
  if (isInvalidCredentialsResponse(runtime.response.status, payload)) return invalidCurrentPassword();
  if (!runtime.response.ok) {
    return upstreamResponseFailure(runtime.response.status, {
      code: 'password_grant_rejected',
      message: 'Authentication runtime rejected the password verification request.',
    });
  }
  const accessToken = typeof payload?.access_token === 'string' ? payload.access_token : '';
  return accessToken ? { ok: true, accessToken, tokenPayload: payload } : invalidRuntimeResponse();
}

async function updatePassword(
  accessToken: string,
  newPassword: string,
  options: RuntimeRequestOptions,
): Promise<PasswordUpdateSuccess | PasswordChangeFailure> {
  const runtime = await firstRuntimeResponse(options, (base) => options.fetchImpl(
    buildGoTrueApiUrl(base, '/user'),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ password: newPassword }),
      signal: AbortSignal.timeout(5000),
    },
  ));
  if (!runtime.ok) return runtime;
  const parsed = await readRuntimeJson(runtime.response);
  if (!parsed.ok) return parsed;
  const { payload } = parsed;
  if (isWeakPasswordResponse(runtime.response.status, payload)) return weakPassword();
  if (!runtime.response.ok) {
    return upstreamResponseFailure(runtime.response.status, {
      code: 'password_update_failed',
      message: 'Authentication runtime rejected the password update request.',
    });
  }
  return { ok: true, payload };
}

export async function changePasswordWithGoTrue(
  input: PasswordChangeInput,
  options: {
    fetchImpl?: typeof fetch;
    runtimeBaseUrls?: string[];
    auditImpl?: typeof auditPasswordChange;
  } = {},
): Promise<PasswordChangeResult> {
  const fetchImpl = options.fetchImpl || fetch;
  const auditImpl = options.auditImpl || auditPasswordChange;
  const bases = goTrueBaseCandidates(options.runtimeBaseUrls);
  if (bases.length === 0) {
    return passwordChangeFailure(500, 'runtime_unavailable', 'Authentication runtime is not configured.');
  }
  const runtimeOptions = { bases, fetchImpl };
  const grant = await passwordGrant(input, runtimeOptions);
  if (!grant.ok) return grant;
  const update = await updatePassword(grant.accessToken, input.newPassword, runtimeOptions);
  if (!update.ok) return update;
  const updatedUserId = userIdFromTokenPayload(grant.tokenPayload)
    || (typeof update.payload?.id === 'string' ? update.payload.id : undefined);
  await auditImpl(updatedUserId, input.email);
  return { ok: true, userId: updatedUserId };
}

async function accountCenterFeatureFailure(
  getAccountCenterConfig: () => Promise<AccountCenterConfig>,
): Promise<PasswordChangeFailure | null> {
  let accountCenterConfig: AccountCenterConfig;
  try {
    accountCenterConfig = await getAccountCenterConfig();
  } catch {
    return passwordChangeFailure(
      503,
      'account_center_unavailable',
      'Account center configuration is temporarily unavailable.',
    );
  }
  return accountCenterConfig.enabled && accountCenterConfig.security.password_change
    ? null
    : passwordChangeFailure(403, 'password_change_disabled', 'Password change is disabled for this account center.');
}

async function authoritativePasswordPolicy(
  getAuthConfig: () => Promise<unknown>,
): Promise<{ ok: true; policy: PublicPasswordPolicy } | PasswordChangeFailure> {
  try {
    return { ok: true, policy: passwordPolicyFromAuthConfig(await getAuthConfig()) };
  } catch {
    return passwordChangeFailure(503, 'password_policy_unavailable', 'Password policy is temporarily unavailable.');
  }
}

function publicPasswordChangeFailure(failure: PasswordChangeFailure) {
  return { success: false, error: { code: failure.code, message: failure.message } };
}

export function createPublicAccountPasswordRoutes(options?: {
  changePassword?: (input: PasswordChangeInput) => Promise<PasswordChangeResult>;
  getAccountCenterConfig?: () => Promise<AccountCenterConfig>;
  getAuthConfig?: () => Promise<unknown>;
}) {
  const changePassword = options?.changePassword || changePasswordWithGoTrue;
  const getAccountCenterConfig = options?.getAccountCenterConfig || readAccountCenterConfig;
  const getAuthConfig = options?.getAuthConfig || (() => adapter.getAuthConfig());

  return new Elysia({ prefix: '/v1/public/account-password' })
    .post('/change', async ({ body, headers, set }) => {
      const featureFailure = await accountCenterFeatureFailure(getAccountCenterConfig);
      if (featureFailure) {
        set.status = featureFailure.status;
        return publicPasswordChangeFailure(featureFailure);
      }
      const parsed = parsePasswordChangeInput(body);
      if (isPasswordChangeFailure(parsed)) {
        set.status = parsed.status;
        return publicPasswordChangeFailure(parsed);
      }

      const ip = requestIp(headers as Record<string, string | undefined>);
      if (!consumeLimit(ip, parsed.email)) {
        set.status = 429;
        return { success: false, error: { code: 'too_many_attempts', message: 'Too many attempts. Please try again later.' } };
      }

      const policy = await authoritativePasswordPolicy(getAuthConfig);
      if (!policy.ok) {
        set.status = policy.status;
        return publicPasswordChangeFailure(policy);
      }
      const policyFailure = passwordPolicyFailure(parsed, policy.policy);
      if (policyFailure) {
        set.status = policyFailure.status;
        return publicPasswordChangeFailure(policyFailure);
      }

      const result = await changePassword(parsed);
      if (!result.ok) {
        set.status = result.status;
        return publicPasswordChangeFailure(result);
      }

      return { success: true, status: 'password_changed' };
    }, {
      detail: { summary: 'Change password with current credentials', tags: ['Public', 'Account Center'] },
    });
}

export const publicAccountPasswordRoutes = createPublicAccountPasswordRoutes();
