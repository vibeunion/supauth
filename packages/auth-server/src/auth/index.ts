// Admin console authentication for SupaOAuth.
// Development accepts ADMIN_TOKEN and issues an in-memory session token.
// Production accepts OIDC access tokens from @svadmin/sso via issuer JWKS.
// Runtime security policy is read from supaoauth.security_config (DB-backed)
// with a short TTL cache so that Admin UI changes take effect without restart.

import { Elysia } from 'elysia';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import * as secRepo from '../repositories/security-config.js';
import type { SecurityConfigRow } from '../repositories/security-config.js';
import { resolveGoTrueLogoutUrl } from './gotrue-logout-url.js';

// Env-var fallbacks: used before migration has run, or when DB is unreachable.
const ENV_ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const ENV_ADMIN_AUTH_MODE = (process.env.ADMIN_AUTH_MODE || 'auto').toLowerCase();
const ENV_SSO_ISSUER = trimTrailingSlash(process.env.ADMIN_SSO_ISSUER || '');
const ENV_SSO_CLIENT_ID = process.env.ADMIN_SSO_CLIENT_ID || '';
const ENV_SSO_AUDIENCES = resolveSsoAudiences({
  configuredAudience: process.env.ADMIN_SSO_AUDIENCE,
  clientId: ENV_SSO_CLIENT_ID,
  issuer: ENV_SSO_ISSUER,
});
const ENV_SSO_JWKS_URI = process.env.ADMIN_SSO_JWKS_URI || (ENV_SSO_ISSUER ? `${ENV_SSO_ISSUER}/.well-known/jwks.json` : '');
const ENV_ALLOWED_EMAILS = parseCsv(process.env.ADMIN_SSO_ALLOWED_EMAILS).map((email) => email.toLowerCase());
const ENV_ALLOWED_DOMAINS = parseCsv(process.env.ADMIN_SSO_ALLOWED_DOMAINS).map((d) => d.toLowerCase());
const ENV_RATE_LIMIT_RPM = parseInt(process.env.ADMIN_RATE_LIMIT_RPM || '300', 10);
const ENV_MAX_LOGIN_ATTEMPTS = parseInt(process.env.ADMIN_MAX_LOGIN_ATTEMPTS || '10', 10);
const ENV_LOGIN_LOCKOUT_SEC = parseInt(process.env.ADMIN_LOGIN_LOCKOUT_SEC || '900', 10);

const RATE_LIMIT_WINDOW_MS = 60_000;
const SECURITY_CONFIG_CACHE_MS = 10_000;
// GoTrue does not advertise end_session_endpoint in OIDC discovery.
const GOTRUE_LOGOUT_URL = resolveGoTrueLogoutUrl();

interface AdminSession {
  id: string;
  email: string;
  name: string;
  role: string;
  authenticated: boolean;
}

interface AdminAllowlist {
  emails: string[];
  domains: string[];
}

type AdminBearerAccess =
  | { status: 'authenticated'; session: AdminSession }
  | { status: 'unauthenticated' }
  | { status: 'forbidden' };

export const ADMIN_SSO_ALLOWLIST_ERROR_CODE = 'admin_sso_allowlist_not_configured';
export const ADMIN_SSO_ALLOWLIST_ERROR_MESSAGE = 'Admin SSO 已启用，但管理员白名单为空；请配置 ADMIN_SSO_ALLOWED_EMAILS 或 ADMIN_SSO_ALLOWED_DOMAINS。';

export function resolveSsoAllowlistConfigurationError(input: {
  enabled: boolean;
  emails: string[];
  domains: string[];
}): string | null {
  if (!input.enabled || input.emails.length > 0 || input.domains.length > 0) return null;
  return ADMIN_SSO_ALLOWLIST_ERROR_MESSAGE;
}

const sessions = new Map<string, AdminSession>();
const jwks = ENV_SSO_JWKS_URI ? createRemoteJWKSet(new URL(ENV_SSO_JWKS_URI)) : null;
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();

// Cached DB security config with TTL so Admin UI policy changes propagate.
let _secConfig: SecurityConfigRow | null = null;
let _secConfigExpiresAt = 0;
let _secConfigLoaded = false;

async function getActiveSecurityConfig(): Promise<SecurityConfigRow | null> {
  const now = Date.now();
  if (now < _secConfigExpiresAt) return _secConfig;
  try {
    _secConfig = await secRepo.getSecurityConfig();
    _secConfigExpiresAt = now + SECURITY_CONFIG_CACHE_MS;
    _secConfigLoaded = true;
  } catch {
    // DB not ready or unreachable: fall back to env-based defaults.
    _secConfigExpiresAt = now + SECURITY_CONFIG_CACHE_MS;
  }
  return _secConfig;
}

/** Resolve effective admin auth mode: DB overrides env when available. */
async function effectiveAdminAuthMode(): Promise<string> {
  const cfg = await getActiveSecurityConfig();
  if (cfg) return cfg.adminAuthMode.toLowerCase();
  return ENV_ADMIN_AUTH_MODE;
}

/** Resolve effective allowed emails/domains from DB, falling back to env. */
async function effectiveAllowedAdmins(): Promise<AdminAllowlist> {
  const cfg = await getActiveSecurityConfig();
  if (cfg && (cfg.adminAllowedEmails.length > 0 || cfg.adminAllowedDomains.length > 0)) {
    return {
      emails: cfg.adminAllowedEmails.map((e) => e.toLowerCase()),
      domains: cfg.adminAllowedDomains.map((d) => d.toLowerCase()),
    };
  }
  return { emails: ENV_ALLOWED_EMAILS, domains: ENV_ALLOWED_DOMAINS };
}

async function effectiveSsoAllowlistConfigurationError(): Promise<string | null> {
  const mode = await effectiveAdminAuthMode();
  const enabled = mode !== 'token' && Boolean(ENV_SSO_ISSUER && ENV_SSO_CLIENT_ID && jwks);
  const { emails, domains } = await effectiveAllowedAdmins();
  return resolveSsoAllowlistConfigurationError({ enabled, emails, domains });
}

function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function parseCsv(value?: string): string[] {
  return (value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isGoTrueIssuer(issuer: string): boolean {
  try {
    const url = new URL(issuer);
    return url.pathname.replace(/\/+$/, '').endsWith('/auth/v1');
  } catch {
    return issuer.replace(/\/+$/, '').endsWith('/auth/v1');
  }
}

export function resolveSsoAudiences(input: {
  configuredAudience?: string;
  clientId?: string;
  issuer?: string;
}): string[] {
  const configured = unique(parseCsv(input.configuredAudience));
  const clientId = (input.clientId || '').trim();
  const gotrueIssuer = isGoTrueIssuer(input.issuer || '');

  const audiences = configured.length > 0
    ? configured
    : unique([clientId]);

  if (gotrueIssuer && (configured.length === 0 || configured.includes(clientId))) {
    audiences.push('authenticated');
  }

  return unique(audiences);
}

function bearerToken(headers: Record<string, string | undefined>): string | null {
  const authHeader = headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

function requestIp(headers: Record<string, string | undefined>): string {
  return (headers['x-forwarded-for'] || headers['x-real-ip'] || 'unknown').split(',')[0].trim();
}

/** Token auth is blocked when DB or env says SSO-only, or in production. */
async function tokenAuthAllowed(): Promise<boolean> {
  const mode = await effectiveAdminAuthMode();
  if (mode === 'sso') return false;
  if (process.env.NODE_ENV === 'production') return false;
  return true;
}

async function consumeRateLimit(ip: string): Promise<boolean> {
  const cfg = await getActiveSecurityConfig();
  const rpm = cfg?.rateLimitRpm ?? ENV_RATE_LIMIT_RPM;
  const now = Date.now();
  const current = rateLimits.get(ip);
  if (!current || current.resetAt <= now) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (current.count >= rpm) return false;
  current.count += 1;
  return true;
}

async function loginLocked(ip: string): Promise<boolean> {
  const cfg = await getActiveSecurityConfig();
  if (cfg && !cfg.bruteForceProtection) return false;
  const current = loginAttempts.get(ip);
  return !!current && current.lockedUntil > Date.now();
}

async function recordLoginFailure(ip: string): Promise<void> {
  const cfg = await getActiveSecurityConfig();
  const maxAttempts = cfg?.maxLoginAttempts ?? ENV_MAX_LOGIN_ATTEMPTS;
  const lockoutSec = cfg?.lockoutDurationSec ?? ENV_LOGIN_LOCKOUT_SEC;
  const now = Date.now();
  const current = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
  const nextCount = current.lockedUntil > now ? current.count : current.count + 1;
  loginAttempts.set(ip, {
    count: nextCount,
    lockedUntil: nextCount >= maxAttempts ? now + lockoutSec * 1000 : 0,
  });
}

function clearLoginFailures(ip: string): void {
  loginAttempts.delete(ip);
}

function sessionFromPayload(payload: JWTPayload): AdminSession {
  const email = typeof payload.email === 'string' ? payload.email : '';
  const name =
    (typeof payload.name === 'string' && payload.name) ||
    (typeof payload.preferred_username === 'string' && payload.preferred_username) ||
    email ||
    String(payload.sub || 'admin');

  return {
    id: String(payload.sub || email || 'admin'),
    email,
    name,
    role: 'admin',
    authenticated: true,
  };
}

export function resolveSsoAdminAccess(
  session: AdminSession,
  allowlist: AdminAllowlist,
): AdminBearerAccess {
  const email = session.email.toLowerCase();
  if (allowlist.emails.includes(email)) return { status: 'authenticated', session };
  const domain = email.split('@')[1] || '';
  return allowlist.domains.includes(domain)
    ? { status: 'authenticated', session }
    : { status: 'forbidden' };
}

async function verifySsoToken(token: string): Promise<AdminBearerAccess> {
  const mode = await effectiveAdminAuthMode();
  if (mode === 'token' || !ENV_SSO_ISSUER || !jwks) return { status: 'unauthenticated' };

  try {
    const result = await jwtVerify(token, jwks, {
      issuer: ENV_SSO_ISSUER,
      audience: ENV_SSO_AUDIENCES.length > 0 ? ENV_SSO_AUDIENCES : undefined,
      algorithms: ['ES256', 'RS256'],
    });
    const session = sessionFromPayload(result.payload);
    return resolveSsoAdminAccess(session, await effectiveAllowedAdmins());
  } catch {
    return { status: 'unauthenticated' };
  }
}

export async function verifyAdminBearer(headers: Record<string, string | undefined>): Promise<AdminBearerAccess> {
  const token = bearerToken(headers);
  if (!token) return { status: 'unauthenticated' };

  const session = sessions.get(token);
  if (session?.authenticated) return { status: 'authenticated', session };

  return verifySsoToken(token);
}

function ssoConfigurationErrorResponse(message: string): Response {
  return Response.json({
    success: false,
    error: {
      code: ADMIN_SSO_ALLOWLIST_ERROR_CODE,
      message,
    },
  }, { status: 503 });
}

export async function adminAuthorizationFailureResponse(
  status: 'unauthenticated' | 'forbidden',
): Promise<Response> {
  const configurationError = await effectiveSsoAllowlistConfigurationError();
  if (configurationError) return ssoConfigurationErrorResponse(configurationError);
  if (status === 'forbidden') {
    return Response.json({
      success: false,
      error: {
        code: 'admin_access_forbidden',
        message: '当前账号没有访问管理控制台的权限。',
      },
    }, { status: 403 });
  }
  return new Response('Unauthorized', { status: 401 });
}

function publicAdminPath(pathname: string): boolean {
  return pathname === '/v1/health'
    || pathname === '/v1/project'
    || pathname.startsWith('/v1/runtime')
    || pathname === '/v1/auth'
    || pathname.startsWith('/v1/auth/')
    || pathname.startsWith('/v1/public')
    || pathname.startsWith('/swagger');
}

export const adminAuthGuard = new Elysia()
  .onBeforeHandle({ as: 'global' }, async ({ request, headers }) => {
    const pathname = new URL(request.url).pathname;
    const ip = requestIp(headers as Record<string, string | undefined>);
    const allowed = await consumeRateLimit(ip);
    if (!allowed) {
      return new Response('Too Many Requests', { status: 429 });
    }
    if (!pathname.startsWith('/v1/') || publicAdminPath(pathname)) return;

    const access = await verifyAdminBearer(headers as Record<string, string | undefined>);
    if (access.status !== 'authenticated') return adminAuthorizationFailureResponse(access.status);
  });

export const authRoutes = new Elysia({ prefix: '/v1/auth' })
  .post('/login', async ({ body, headers }) => {
    const { token } = body as Record<string, string>;
    const ip = requestIp(headers as Record<string, string | undefined>);

    if (await loginLocked(ip)) {
      return new Response('Too Many Requests', { status: 429 });
    }

    const tokenOk = await tokenAuthAllowed();
    if (tokenOk && ENV_ADMIN_TOKEN && token === ENV_ADMIN_TOKEN) {
      const sessionToken = generateSessionToken();
      const session: AdminSession = {
        id: 'admin',
        email: 'admin@supaoauth.local',
        name: 'Admin',
        role: 'admin',
        authenticated: true,
      };
      sessions.set(sessionToken, session);
      clearLoginFailures(ip);
      return { success: true, token: sessionToken };
    }

    await recordLoginFailure(ip);
    return { success: false, error: { message: await ssoMessage() || 'Invalid credentials' } };
  })
  .post('/logout', async ({ headers, request }) => {
    const token = bearerToken(headers as Record<string, string | undefined>);
    // 清除 in-memory admin session（dev 模式 ADMIN_TOKEN 登录的 token）
    if (token) sessions.delete(token);

    // SSO 模式下还需要清除 GoTrue 的 session cookie。
    // GoTrue 的 bearer token 是 JWT，不在 sessions Map 里，
    // 但 GoTrue 域的 httpOnly session cookie 仍有效，不清除的话
    // 下次 authorize GoTrue 会直接发 code，用户感觉"没退出"。
    if (GOTRUE_LOGOUT_URL) {
      try {
        const cookie = (headers as Record<string, string | undefined>).cookie || '';
        const authorization = (headers as Record<string, string | undefined>).authorization || '';
        await fetch(GOTRUE_LOGOUT_URL, {
          method: 'POST',
          headers: {
            ...(cookie ? { cookie } : {}),
            ...(authorization ? { authorization } : {}),
          },
        });
      } catch {
        // GoTrue 不可达时仍返回成功，前端也会直接清本地 token
      }
    }

    // 设置 Set-Cookie 头清除浏览器侧可能残留的 SupaOAuth session cookie
    const setCookieHeaders: string[] = [];

    return new Response(JSON.stringify({ success: true }), {
      headers: {
        'content-type': 'application/json',
        ...(setCookieHeaders.length ? { 'set-cookie': setCookieHeaders.join(', ') } : {}),
      },
    });
  })
  .get('/identity', async ({ headers }) => {
    const access = await verifyAdminBearer(headers as Record<string, string | undefined>);
    if (access.status !== 'authenticated') return adminAuthorizationFailureResponse(access.status);
    const { session } = access;
    return {
      id: session.id,
      name: session.name,
      email: session.email,
      avatar: null,
    };
  })
  .get('/health', () => ({ status: 'ok' }));

async function ssoMessage(): Promise<string | null> {
  const configurationError = await effectiveSsoAllowlistConfigurationError();
  if (configurationError) return configurationError;
  const mode = await effectiveAdminAuthMode();
  if (mode === 'sso') return 'Password login is disabled; use SSO';
  if (process.env.NODE_ENV === 'production') return 'Token login is disabled in production; use SSO';
  return null;
}
