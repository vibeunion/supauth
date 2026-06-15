// Admin console authentication for SupaOAuth.
// Development accepts ADMIN_TOKEN and issues an in-memory session token.
// Production accepts OIDC access tokens from @svadmin/sso via issuer JWKS.
// Runtime security policy is read from supaoauth.security_config (DB-backed)
// with a short TTL cache so that Admin UI changes take effect without restart.

import { Elysia } from 'elysia';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import * as secRepo from '../repositories/security-config.js';
import type { SecurityConfigRow } from '../repositories/security-config.js';

// Env-var fallbacks: used before migration has run, or when DB is unreachable.
const ENV_ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const ENV_ADMIN_AUTH_MODE = (process.env.ADMIN_AUTH_MODE || 'auto').toLowerCase();
const ENV_SSO_ISSUER = trimTrailingSlash(process.env.ADMIN_SSO_ISSUER || '');
const ENV_SSO_CLIENT_ID = process.env.ADMIN_SSO_CLIENT_ID || '';
const ENV_SSO_AUDIENCE = process.env.ADMIN_SSO_AUDIENCE || ENV_SSO_CLIENT_ID;
const ENV_SSO_JWKS_URI = process.env.ADMIN_SSO_JWKS_URI || (ENV_SSO_ISSUER ? `${ENV_SSO_ISSUER}/.well-known/jwks.json` : '');
const ENV_ALLOWED_EMAILS = parseCsv(process.env.ADMIN_SSO_ALLOWED_EMAILS);
const ENV_ALLOWED_DOMAINS = parseCsv(process.env.ADMIN_SSO_ALLOWED_DOMAINS).map((d) => d.toLowerCase());
const ENV_RATE_LIMIT_RPM = parseInt(process.env.ADMIN_RATE_LIMIT_RPM || '300', 10);
const ENV_MAX_LOGIN_ATTEMPTS = parseInt(process.env.ADMIN_MAX_LOGIN_ATTEMPTS || '10', 10);
const ENV_LOGIN_LOCKOUT_SEC = parseInt(process.env.ADMIN_LOGIN_LOCKOUT_SEC || '900', 10);

const RATE_LIMIT_WINDOW_MS = 60_000;
const SECURITY_CONFIG_CACHE_MS = 10_000;

interface AdminSession {
  id: string;
  email: string;
  name: string;
  role: string;
  authenticated: boolean;
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
async function effectiveAllowedAdmins(): Promise<{ emails: string[]; domains: string[] }> {
  const cfg = await getActiveSecurityConfig();
  if (cfg && (cfg.adminAllowedEmails.length > 0 || cfg.adminAllowedDomains.length > 0)) {
    return {
      emails: cfg.adminAllowedEmails.map((e) => e.toLowerCase()),
      domains: cfg.adminAllowedDomains.map((d) => d.toLowerCase()),
    };
  }
  return { emails: ENV_ALLOWED_EMAILS, domains: ENV_ALLOWED_DOMAINS };
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

async function isAllowedSsoAdmin(session: AdminSession): Promise<boolean> {
  const { emails, domains } = await effectiveAllowedAdmins();
  if (emails.length === 0 && domains.length === 0) return true;
  const email = session.email.toLowerCase();
  if (emails.includes(email)) return true;
  const domain = email.split('@')[1] || '';
  return domains.includes(domain);
}

async function verifySsoToken(token: string): Promise<AdminSession | null> {
  const mode = await effectiveAdminAuthMode();
  if (mode === 'token' || !ENV_SSO_ISSUER || !jwks) return null;

  try {
    const result = await jwtVerify(token, jwks, {
      issuer: ENV_SSO_ISSUER,
      audience: ENV_SSO_AUDIENCE || undefined,
      algorithms: ['ES256', 'RS256'],
    });
    const session = sessionFromPayload(result.payload);
    const allowed = await isAllowedSsoAdmin(session);
    return allowed ? session : null;
  } catch {
    return null;
  }
}

export async function verifyAdminBearer(headers: Record<string, string | undefined>): Promise<AdminSession | null> {
  const token = bearerToken(headers);
  if (!token) return null;

  const session = sessions.get(token);
  if (session?.authenticated) return session;

  return verifySsoToken(token);
}

function publicAdminPath(pathname: string): boolean {
  return pathname === '/v1/health'
    || pathname === '/v1/project'
    || pathname.startsWith('/v1/runtime')
    || pathname.startsWith('/v1/auth')
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

    const session = await verifyAdminBearer(headers as Record<string, string | undefined>);
    if (!session) {
      return new Response('Unauthorized', { status: 401 });
    }
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
  .post('/logout', async ({ headers }) => {
    const token = bearerToken(headers as Record<string, string | undefined>);
    if (token) sessions.delete(token);
    return { success: true };
  })
  .get('/identity', async ({ headers }) => {
    const session = await verifyAdminBearer(headers as Record<string, string | undefined>);
    if (!session) {
      return new Response('Unauthorized', { status: 401 });
    }
    return {
      id: session.id,
      name: session.name,
      email: session.email,
      avatar: null,
    };
  })
  .get('/health', () => ({ status: 'ok' }));

async function ssoMessage(): Promise<string | null> {
  const mode = await effectiveAdminAuthMode();
  if (mode === 'sso') return 'Password login is disabled; use SSO';
  if (process.env.NODE_ENV === 'production') return 'Token login is disabled in production; use SSO';
  return null;
}
