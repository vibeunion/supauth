import { describe, it, expect, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';
import {
  ADMIN_SSO_ALLOWLIST_ERROR_MESSAGE,
  adminAuthorizationFailureResponse,
  resolveSsoAllowlistConfigurationError,
  resolveSsoAdminAccess,
  resolveSsoAudiences,
  verifyAdminBearer,
} from '../auth/index.js';

describe('Auth module — exported functions', () => {
  beforeEach(() => {
    process.env.ADMIN_TOKEN = 'test-admin-token';
    process.env.ADMIN_AUTH_MODE = 'auto';
    process.env.NODE_ENV = 'test';
    delete process.env.ADMIN_SSO_ISSUER;
    delete process.env.ADMIN_SSO_CLIENT_ID;
    delete process.env.ADMIN_SSO_JWKS_URI;
    delete process.env.ADMIN_SSO_ALLOWED_EMAILS;
    delete process.env.ADMIN_SSO_ALLOWED_DOMAINS;
  });

  describe('verifyAdminBearer', () => {
    it('returns unauthenticated when no authorization header', async () => {
      const result = await verifyAdminBearer({});
      expect(result).toEqual({ status: 'unauthenticated' });
    });

    it('returns unauthenticated when authorization header has no Bearer prefix', async () => {
      const result = await verifyAdminBearer({ authorization: 'Basic abc123' });
      expect(result).toEqual({ status: 'unauthenticated' });
    });

    it('returns unauthenticated when Bearer token is not a known session or SSO token', async () => {
      const result = await verifyAdminBearer({ authorization: 'Bearer unknown-token' });
      expect(result).toEqual({ status: 'unauthenticated' });
    });

    it('returns unauthenticated for empty Bearer token', async () => {
      const result = await verifyAdminBearer({ authorization: 'Bearer ' });
      expect(result).toEqual({ status: 'unauthenticated' });
    });
  });
});

describe('Auth module — SSO audience resolution', () => {
  it('uses the OIDC client id as the generic default audience', () => {
    expect(resolveSsoAudiences({
      issuer: 'https://idp.example.test',
      clientId: 'admin-client',
    })).toEqual(['admin-client']);
  });

  it('accepts GoTrue access-token audience for hosted auth issuers', () => {
    expect(resolveSsoAudiences({
      issuer: 'https://auth.example.test/auth/v1',
      clientId: 'admin-client',
    })).toEqual(['admin-client', 'authenticated']);
  });

  it('keeps explicit non-client audiences strict', () => {
    expect(resolveSsoAudiences({
      configuredAudience: 'supaoauth-admin-api',
      issuer: 'https://auth.example.test/auth/v1',
      clientId: 'admin-client',
    })).toEqual(['supaoauth-admin-api']);
  });

  it('treats legacy client-id audience config as compatible with GoTrue access tokens', () => {
    expect(resolveSsoAudiences({
      configuredAudience: 'admin-client',
      issuer: 'https://auth.example.test/auth/v1',
      clientId: 'admin-client',
    })).toEqual(['admin-client', 'authenticated']);
  });
});

describe('Auth module — SSO administrator allowlist', () => {
  const verifiedSession = {
    id: 'user-1',
    email: 'member@example.test',
    name: 'Member',
    role: 'admin',
    authenticated: true,
  };

  it('fails closed with an explicit configuration error when enabled without an allowlist', () => {
    expect(resolveSsoAllowlistConfigurationError({
      enabled: true,
      emails: [],
      domains: [],
    })).toBe(ADMIN_SSO_ALLOWLIST_ERROR_MESSAGE);
  });

  it('does not affect token mode or configured SSO allowlists', () => {
    expect(resolveSsoAllowlistConfigurationError({
      enabled: false,
      emails: [],
      domains: [],
    })).toBeNull();
    expect(resolveSsoAllowlistConfigurationError({
      enabled: true,
      emails: ['admin@example.test'],
      domains: [],
    })).toBeNull();
    expect(resolveSsoAllowlistConfigurationError({
      enabled: true,
      emails: [],
      domains: ['example.test'],
    })).toBeNull();
  });

  it('classifies a verified user outside the allowlist as forbidden', () => {
    expect(resolveSsoAdminAccess(verifiedSession, {
      emails: ['admin@example.test'],
      domains: ['trusted.example.test'],
    })).toEqual({ status: 'forbidden' });
  });

  it('accepts a verified user whose email is explicitly allowed', () => {
    expect(resolveSsoAdminAccess(verifiedSession, {
      emails: ['member@example.test'],
      domains: [],
    })).toEqual({ status: 'authenticated', session: verifiedSession });
  });

  it('returns a structured 403 response for a forbidden admin identity', async () => {
    const response = await adminAuthorizationFailureResponse('forbidden');

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      error: {
        code: 'admin_access_forbidden',
        message: '当前账号没有访问管理控制台的权限。',
      },
    });
  });
});

describe('Auth module — guard and route structure', () => {
  it('exports adminAuthGuard as Elysia instance', async () => {
    const { adminAuthGuard } = await import('../auth/index.js');
    expect(adminAuthGuard).toBeDefined();
    // Elysia instances have a fetch method or similar
    expect(typeof adminAuthGuard.fetch).toBe('function');
  });

  it('exports authRoutes as Elysia instance', async () => {
    const { authRoutes } = await import('../auth/index.js');
    expect(authRoutes).toBeDefined();
    expect(typeof authRoutes.fetch).toBe('function');
  });

  it('keeps auth-config protected while leaving auth routes public', async () => {
    const { adminAuthGuard } = await import('../auth/index.js');
    const app = new Elysia()
      .use(adminAuthGuard)
      .get('/v1/auth/login', () => 'public auth')
      .get('/v1/auth-config', () => 'protected auth config')
      .get('/v1/auth-config/runtime-consistency', () => 'protected runtime consistency');

    const authRoute = await app.handle(new Request('http://localhost/v1/auth/login'));
    expect(authRoute.status).toBe(200);

    const authConfig = await app.handle(new Request('http://localhost/v1/auth-config'));
    expect(authConfig.status).toBe(401);

    const runtimeConsistency = await app.handle(new Request('http://localhost/v1/auth-config/runtime-consistency'));
    expect(runtimeConsistency.status).toBe(401);
  });

  it('keeps the Admin SPA runtime SSO config public', async () => {
    const { adminAuthGuard } = await import('../auth/index.js');
    const app = new Elysia()
      .use(adminAuthGuard)
      .get('/v1/public/admin-sso-config', () => ({ enabled: true }));

    const response = await app.handle(new Request('http://localhost/v1/public/admin-sso-config'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: true });
  });
});
