// Admin console authentication for SupaOAuth.
// Development accepts ADMIN_TOKEN and issues an in-memory session token.
// Production accepts OIDC access tokens from @svadmin/sso via issuer JWKS.

import { Elysia } from 'elysia';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const ADMIN_AUTH_MODE = (process.env.ADMIN_AUTH_MODE || 'auto').toLowerCase();
const ADMIN_SSO_ISSUER = trimTrailingSlash(process.env.ADMIN_SSO_ISSUER || '');
const ADMIN_SSO_CLIENT_ID = process.env.ADMIN_SSO_CLIENT_ID || '';
const ADMIN_SSO_AUDIENCE = process.env.ADMIN_SSO_AUDIENCE || ADMIN_SSO_CLIENT_ID;
const ADMIN_SSO_JWKS_URI = process.env.ADMIN_SSO_JWKS_URI || (ADMIN_SSO_ISSUER ? `${ADMIN_SSO_ISSUER}/.well-known/jwks.json` : '');
const ADMIN_SSO_ALLOWED_EMAILS = parseCsv(process.env.ADMIN_SSO_ALLOWED_EMAILS);
const ADMIN_SSO_ALLOWED_DOMAINS = parseCsv(process.env.ADMIN_SSO_ALLOWED_DOMAINS).map((domain) => domain.toLowerCase());
const RATE_LIMIT_RPM = parseInt(process.env.ADMIN_RATE_LIMIT_RPM || '300', 10);
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_LOGIN_ATTEMPTS = parseInt(process.env.ADMIN_MAX_LOGIN_ATTEMPTS || '10', 10);
const LOGIN_LOCKOUT_MS = parseInt(process.env.ADMIN_LOGIN_LOCKOUT_SEC || '900', 10) * 1000;

interface AdminSession {
  id: string;
  email: string;
  name: string;
  role: string;
  authenticated: boolean;
}

const sessions = new Map<string, AdminSession>();
const jwks = ADMIN_SSO_JWKS_URI ? createRemoteJWKSet(new URL(ADMIN_SSO_JWKS_URI)) : null;
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();

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

function tokenAuthAllowed(): boolean {
  return ADMIN_AUTH_MODE !== 'sso' && process.env.NODE_ENV !== 'production';
}

function consumeRateLimit(ip: string): boolean {
  const now = Date.now();
  const current = rateLimits.get(ip);
  if (!current || current.resetAt <= now) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (current.count >= RATE_LIMIT_RPM) return false;
  current.count += 1;
  return true;
}

function loginLocked(ip: string): boolean {
  const current = loginAttempts.get(ip);
  return !!current && current.lockedUntil > Date.now();
}

function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const current = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
  const nextCount = current.lockedUntil > now ? current.count : current.count + 1;
  loginAttempts.set(ip, {
    count: nextCount,
    lockedUntil: nextCount >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_LOCKOUT_MS : 0,
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

function isAllowedSsoAdmin(session: AdminSession): boolean {
  if (ADMIN_SSO_ALLOWED_EMAILS.length === 0 && ADMIN_SSO_ALLOWED_DOMAINS.length === 0) return true;
  const email = session.email.toLowerCase();
  if (ADMIN_SSO_ALLOWED_EMAILS.map((item) => item.toLowerCase()).includes(email)) return true;
  const domain = email.split('@')[1] || '';
  return ADMIN_SSO_ALLOWED_DOMAINS.includes(domain);
}

async function verifySsoToken(token: string): Promise<AdminSession | null> {
  if (ADMIN_AUTH_MODE === 'token' || !ADMIN_SSO_ISSUER || !jwks) return null;

  try {
    const result = await jwtVerify(token, jwks, {
      issuer: ADMIN_SSO_ISSUER,
      audience: ADMIN_SSO_AUDIENCE || undefined,
      algorithms: ['ES256', 'RS256'],
    });
    const session = sessionFromPayload(result.payload);
    return isAllowedSsoAdmin(session) ? session : null;
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
    if (!consumeRateLimit(ip)) {
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
    const { token, email, password } = body as Record<string, string>;
    const ip = requestIp(headers as Record<string, string | undefined>);

    if (loginLocked(ip)) {
      return new Response('Too Many Requests', { status: 429 });
    }

    // Development mode: accept ADMIN_TOKEN directly
    if (tokenAuthAllowed() && ADMIN_TOKEN && token === ADMIN_TOKEN) {
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

    recordLoginFailure(ip);
    return { success: false, error: { message: USE_SSO_MESSAGE() || 'Invalid credentials' } };
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

function USE_SSO_MESSAGE(): string | null {
  if (ADMIN_AUTH_MODE === 'sso') return 'Password login is disabled; use SSO';
  if (process.env.NODE_ENV === 'production') return 'Token login is disabled in production; use SSO';
  return null;
}
