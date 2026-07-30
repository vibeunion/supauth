// Admin console authentication for SupaOAuth.
// Development accepts ADMIN_TOKEN and issues an in-memory session token.
// Production accepts OIDC access tokens from @svadmin/sso via issuer JWKS.
// Runtime security policy is read from supaoauth.security_config (DB-backed)
// with a short TTL cache so that Admin UI changes take effect without restart.

import { Elysia } from 'elysia';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { getConfig } from '../config/index.js';
import * as secRepo from '../repositories/security-config.js';
import type { SecurityConfigRow } from '../repositories/security-config.js';
import { resolveGoTrueLogoutUrl } from './gotrue-logout-url.js';
import { principalHasAction, requiredAdminAction, type AdminPrincipal } from './admin-permissions.js';
import { enterAdminRequestContext } from './request-context.js';

// Env-var fallbacks: used before migration has run, or when DB is unreachable.
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
const ADMIN_CLAIM_PROJECTION_LIMITS = { roles: 64, permissions: 256 } as const;
const GOTRUE_LOGOUT_URL = resolveGoTrueLogoutUrl();
const GOTRUE_LOGOUT_TIMEOUT_MS = 3_000;

export interface AdminSession {
  id: string;
  email: string;
  name: string;
  role: string;
  authenticated: boolean;
  roles?: string[];
  permissions?: string[];
  authorizationSource?: AdminPrincipal['authorization_source'];
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
  return authHeader?.match(/^Bearer +([^\s]+)$/i)?.[1] || null;
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

export function adminSessionFromPayload(payload: JWTPayload): AdminSession {
  const email = typeof payload.email === 'string' ? payload.email : '';
  const roles = projectedAdminClaimStrings(payload, 'roles');
  const permissions = projectedAdminClaimStrings(payload, 'permissions');
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
    roles,
    permissions,
    authorizationSource: hasSupaoauthNamespace(payload) ? 'rbac_projection' : 'admin_allowlist',
  };
}

function hasSupaoauthNamespace(payload: JWTPayload): boolean {
  const appMetadata = claimRecord(payload.app_metadata);
  return Boolean(appMetadata && Object.hasOwn(appMetadata, 'supaoauth'));
}

function claimRecord(claim: unknown): Record<string, unknown> | null {
  return claim && typeof claim === 'object' && !Array.isArray(claim)
    ? claim as Record<string, unknown>
    : null;
}

function configuredProjectProjection(payload: JWTPayload): Record<string, unknown> | null {
  const appMetadata = claimRecord(payload.app_metadata);
  const supaoauth = claimRecord(appMetadata?.supaoauth);
  if (!supaoauth) return null;
  if (supaoauth.schema_version !== 2) return null;
  const projects = claimRecord(supaoauth.projects);
  if (!projects) return null;
  const projectRef = getConfig().projectRef;
  return Object.hasOwn(projects, projectRef) ? claimRecord(projects[projectRef]) : null;
}

function boundedProjectedStrings(values: unknown, field: 'roles' | 'permissions'): string[] {
  if (!Array.isArray(values)) return [];
  if (!values.every((entry): entry is string => typeof entry === 'string' && entry.length > 0)) return [];
  if (new Set(values).size !== values.length) return [];
  return values.length <= ADMIN_CLAIM_PROJECTION_LIMITS[field] ? values : [];
}

export function projectedAdminClaimStrings(
  payload: JWTPayload,
  field: 'roles' | 'permissions',
): string[] {
  const projectProjection = configuredProjectProjection(payload);
  if (!projectProjection) return [];
  if (projectProjection.projection_unavailable === true) return [];
  if (projectProjection[`${field}_truncated`] === true) return [];
  return boundedProjectedStrings(projectProjection[field], field);
}

export function adminPrincipalFromSession(session: AdminSession): AdminPrincipal {
  const projectedPermissions = session.permissions || [];
  const usesRbacProjection = session.authorizationSource === 'rbac_projection';
  return {
    id: session.id,
    email: session.email,
    name: session.name,
    roles: session.roles?.length ? session.roles : usesRbacProjection ? [] : [session.role],
    permissions: projectedPermissions.length ? projectedPermissions : usesRbacProjection ? [] : ['*'],
    authorization_source: session.authorizationSource || 'admin_allowlist',
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

async function verifiedSsoPayload(token: string): Promise<JWTPayload | null> {
  if (!ENV_SSO_ISSUER || !jwks) return null;
  try {
    const verified = await jwtVerify(token, jwks, {
      issuer: ENV_SSO_ISSUER,
      audience: ENV_SSO_AUDIENCES.length > 0 ? ENV_SSO_AUDIENCES : undefined,
      algorithms: ['ES256', 'RS256'],
    });
    return verified.payload;
  } catch {
    return null;
  }
}

async function verifySsoToken(token: string): Promise<AdminBearerAccess> {
  const mode = await effectiveAdminAuthMode();
  if (mode === 'token') return { status: 'unauthenticated' };
  const payload = await verifiedSsoPayload(token);
  if (!payload) return { status: 'unauthenticated' };
  const session = adminSessionFromPayload(payload);
  return resolveSsoAdminAccess(session, await effectiveAllowedAdmins());
}

export interface AdminLogoutDependencies {
  logoutUrl: string;
  fetchImpl: typeof fetch;
  verifyToken: (token: string) => Promise<JWTPayload | null>;
}

function logoutFailure(status: number, code: string, message: string): Response {
  return Response.json({ success: false, error: { code, message } }, { status });
}

function upstreamLogoutUrl(logoutUrl: string): string {
  const url = new URL(logoutUrl);
  url.searchParams.set('scope', 'local');
  return url.toString();
}

async function revokeGoTrueSession(
  token: string,
  dependencies: AdminLogoutDependencies,
): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await dependencies.fetchImpl(upstreamLogoutUrl(dependencies.logoutUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(GOTRUE_LOGOUT_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name);
    return logoutFailure(
      timedOut ? 504 : 502,
      timedOut ? 'gotrue_logout_timeout' : 'gotrue_logout_unavailable',
      timedOut ? '认证服务退出请求超时。' : '认证服务当前无法完成退出。',
    );
  }
  if (upstream.ok) return Response.json({ success: true, scope: 'local' });
  const status = upstream.status === 401 || upstream.status === 403 ? upstream.status : 502;
  return logoutFailure(status, 'gotrue_logout_rejected', `认证服务拒绝退出请求（${upstream.status}）。`);
}

export async function logoutAdminSession(
  headers: Record<string, string | undefined>,
  dependencies: AdminLogoutDependencies = {
    logoutUrl: GOTRUE_LOGOUT_URL,
    fetchImpl: globalThis.fetch,
    verifyToken: verifiedSsoPayload,
  },
): Promise<Response> {
  const token = bearerToken(headers);
  if (!token) return logoutFailure(401, 'missing_bearer_token', '退出登录需要 Bearer token。');
  if (sessions.delete(token)) return Response.json({ success: true, scope: 'local' });
  if (!dependencies.logoutUrl) {
    return logoutFailure(503, 'gotrue_logout_not_configured', '认证服务退出地址未配置。');
  }
  const payload = await dependencies.verifyToken(token);
  if (!payload) return logoutFailure(401, 'invalid_bearer_token', 'Bearer token 无效或已过期。');
  if (typeof payload.session_id !== 'string' || !payload.session_id) {
    return logoutFailure(422, 'session_id_required', '当前 token 无法安全执行 local scope 退出。');
  }
  return revokeGoTrueSession(token, dependencies);
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
  .derive({ as: 'global' }, async ({ request, headers }) => {
    const pathname = new URL(request.url).pathname;
    const adminCorrelationId = request.headers.get('x-request-id') || generateSessionToken().slice(0, 16);
    if (!pathname.startsWith('/v1/') || publicAdminPath(pathname)) {
      return { adminAccess: null, adminPrincipal: null, adminCorrelationId };
    }
    const adminAccess = await verifyAdminBearer(headers as Record<string, string | undefined>);
    return {
      adminAccess,
      adminPrincipal: adminAccess.status === 'authenticated' ? adminPrincipalFromSession(adminAccess.session) : null,
      adminCorrelationId,
    };
  })
  .onBeforeHandle({ as: 'global' }, async ({
    request,
    headers,
    adminAccess,
    adminPrincipal,
    adminCorrelationId,
  }) => {
    const pathname = new URL(request.url).pathname;
    const ip = requestIp(headers as Record<string, string | undefined>);
    const allowed = await consumeRateLimit(ip);
    if (!allowed) {
      return new Response('Too Many Requests', { status: 429 });
    }
    if (!pathname.startsWith('/v1/') || publicAdminPath(pathname)) return;

    if (!adminAccess || adminAccess.status !== 'authenticated') {
      return adminAuthorizationFailureResponse(adminAccess?.status || 'unauthenticated');
    }
    if (adminPrincipal) {
      enterAdminRequestContext({ requestId: adminCorrelationId, principal: adminPrincipal });
    }
    const requiredAction = requiredAdminAction(request.method, pathname);
    if (requiredAction && (!adminPrincipal || !principalHasAction(adminPrincipal, requiredAction))) {
      return adminPermissionFailureResponse(requiredAction, adminCorrelationId);
    }
  });

export function adminPermissionFailureResponse(requiredAction: string, correlationId: string): Response {
  return Response.json({
    success: false,
    error: {
      code: 'insufficient_permissions',
      message: '当前账号没有执行此操作的权限。',
      correlation_id: correlationId,
      details: { required_action: requiredAction },
    },
  }, { status: 403 });
}

export const authRoutes = new Elysia({ prefix: '/v1/auth' })
  .post('/login', async ({ body, headers }) => {
    const { token } = body as Record<string, string>;
    const ip = requestIp(headers as Record<string, string | undefined>);

    if (await loginLocked(ip)) {
      return new Response('Too Many Requests', { status: 429 });
    }

    const tokenOk = await tokenAuthAllowed();
    const adminToken = process.env.ADMIN_TOKEN || '';
    if (tokenOk && adminToken && token === adminToken) {
      const sessionToken = generateSessionToken();
      const session: AdminSession = {
        id: 'admin',
        email: 'admin@supaoauth.local',
        name: 'Admin',
        role: 'admin',
        authenticated: true,
        roles: ['admin'],
        permissions: ['*'],
        authorizationSource: 'development_token',
      };
      sessions.set(sessionToken, session);
      clearLoginFailures(ip);
      return { success: true, token: sessionToken };
    }

    await recordLoginFailure(ip);
    return { success: false, error: { message: await ssoMessage() || 'Invalid credentials' } };
  })
  .post('/logout', ({ headers }) => (
    logoutAdminSession(headers as Record<string, string | undefined>)
  ))
  .get('/identity', async ({ headers }) => {
    const access = await verifyAdminBearer(headers as Record<string, string | undefined>);
    if (access.status !== 'authenticated') return adminAuthorizationFailureResponse(access.status);
    const { session } = access;
    const principal = adminPrincipalFromSession(session);
    return {
      ...principal,
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
