// Public self-service password change flow.
// The browser never receives or sends service-role credentials: the route first
// verifies the current password through GoTrue password grant, then updates the
// password with the returned user access token.

import { Elysia } from 'elysia';
import { getConfig } from '../config/index.js';
import * as auditRepo from '../repositories/audit.js';

const PASSWORD_CHANGE_LIMIT_WINDOW_MS = 60_000;
const PASSWORD_CHANGE_LIMIT_MAX = 8;
const MIN_PASSWORD_LENGTH = 6;
const attempts = new Map<string, { count: number; resetAt: number }>();

interface PasswordChangeInput {
  email: string;
  currentPassword: string;
  newPassword: string;
}

interface PasswordChangeSuccess {
  ok: true;
  userId?: string;
}

interface PasswordChangeFailure {
  ok: false;
  status: number;
  code: string;
  message: string;
}

type PasswordChangeResult = PasswordChangeSuccess | PasswordChangeFailure;

function requestIp(headers: Record<string, string | undefined>): string {
  return (headers['x-forwarded-for'] || headers['x-real-ip'] || 'unknown').split(',')[0].trim();
}

function rateLimitKey(ip: string, email: string) {
  return `${ip}:${email.toLowerCase()}`;
}

function consumeLimit(ip: string, email: string): boolean {
  const now = Date.now();
  const key = rateLimitKey(ip, email);
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + PASSWORD_CHANGE_LIMIT_WINDOW_MS });
    return true;
  }
  if (current.count >= PASSWORD_CHANGE_LIMIT_MAX) return false;
  current.count += 1;
  return true;
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

function validatePayload(body: unknown): PasswordChangeInput | PasswordChangeFailure {
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
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      status: 400,
      code: 'weak_password',
      message: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
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
  const text = await response.text().catch(() => '');
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function userIdFromTokenPayload(payload: Record<string, unknown> | null): string | undefined {
  if (!payload) return undefined;
  const user = payload.user;
  if (isRecord(user) && typeof user.id === 'string') return user.id;
  return undefined;
}

function invalidCurrentPassword(): PasswordChangeFailure {
  return {
    ok: false,
    status: 400,
    code: 'invalid_current_password',
    message: 'Current password is incorrect.',
  };
}

async function auditPasswordChange(userId: string | undefined, email: string) {
  try {
    await auditRepo.logAudit({
      eventType: 'my_account.password.changed',
      actorId: userId || email,
      actorType: 'user',
      resourceType: 'user',
      resourceId: userId || email,
      details: { method: 'password' },
    });
  } catch {}
}

export async function changePasswordWithGoTrue(
  input: PasswordChangeInput,
  options: {
    fetchImpl?: typeof fetch;
    runtimeBaseUrls?: string[];
  } = {},
): Promise<PasswordChangeResult> {
  const fetchImpl = options.fetchImpl || fetch;
  const bases = goTrueBaseCandidates(options.runtimeBaseUrls);
  if (bases.length === 0) {
    return {
      ok: false,
      status: 500,
      code: 'runtime_unavailable',
      message: 'Authentication runtime is not configured.',
    };
  }

  let tokenPayload: Record<string, unknown> | null = null;
  let accessToken = '';
  let lastError: unknown = null;

  for (const base of bases) {
    try {
      const response = await fetchImpl(`${buildGoTrueApiUrl(base, '/token')}?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: input.email, password: input.currentPassword }),
        signal: AbortSignal.timeout(5000),
      });
      const payload = await readJson(response);
      if (!response.ok) return invalidCurrentPassword();
      accessToken = typeof payload?.access_token === 'string' ? payload.access_token : '';
      if (!accessToken) return invalidCurrentPassword();
      tokenPayload = payload;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!accessToken) {
    return {
      ok: false,
      status: 502,
      code: 'runtime_unavailable',
      message: lastError instanceof Error ? lastError.message : 'Authentication runtime is unavailable.',
    };
  }

  let updateLastError: unknown = null;
  for (const base of bases) {
    try {
      const response = await fetchImpl(buildGoTrueApiUrl(base, '/user'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ password: input.newPassword }),
        signal: AbortSignal.timeout(5000),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          code: 'password_update_failed',
          message: typeof payload?.message === 'string' ? payload.message : 'Password update failed.',
        };
      }
      const userId = userIdFromTokenPayload(tokenPayload) || (typeof payload?.id === 'string' ? payload.id : undefined);
      await auditPasswordChange(userId, input.email);
      return { ok: true, userId };
    } catch (error) {
      updateLastError = error;
    }
  }

  return {
    ok: false,
    status: 502,
    code: 'runtime_unavailable',
    message: updateLastError instanceof Error ? updateLastError.message : 'Authentication runtime is unavailable.',
  };
}

export function createPublicAccountPasswordRoutes(options?: {
  changePassword?: (input: PasswordChangeInput) => Promise<PasswordChangeResult>;
}) {
  const changePassword = options?.changePassword || changePasswordWithGoTrue;

  return new Elysia({ prefix: '/v1/public/account-password' })
    .post('/change', async ({ body, headers, set }) => {
      const parsed = validatePayload(body);
      if (isPasswordChangeFailure(parsed)) {
        set.status = parsed.status;
        return { success: false, error: { code: parsed.code, message: parsed.message } };
      }

      const ip = requestIp(headers as Record<string, string | undefined>);
      if (!consumeLimit(ip, parsed.email)) {
        set.status = 429;
        return { success: false, error: { code: 'too_many_attempts', message: 'Too many attempts. Please try again later.' } };
      }

      const result = await changePassword(parsed);
      if (!result.ok) {
        set.status = result.status;
        return { success: false, error: { code: result.code, message: result.message } };
      }

      return { success: true, status: 'password_changed' };
    }, {
      detail: { summary: 'Change password with current credentials', tags: ['Public', 'Account Center'] },
    });
}

export const publicAccountPasswordRoutes = createPublicAccountPasswordRoutes();
