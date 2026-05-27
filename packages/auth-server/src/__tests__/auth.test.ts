import { describe, it, expect, beforeEach } from 'bun:test';
import { verifyAdminBearer } from '../auth/index.js';

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
    it('returns null when no authorization header', async () => {
      const result = await verifyAdminBearer({});
      expect(result).toBeNull();
    });

    it('returns null when authorization header has no Bearer prefix', async () => {
      const result = await verifyAdminBearer({ authorization: 'Basic abc123' });
      expect(result).toBeNull();
    });

    it('returns null when Bearer token is not a known session or SSO token', async () => {
      const result = await verifyAdminBearer({ authorization: 'Bearer unknown-token' });
      expect(result).toBeNull();
    });

    it('returns null for empty Bearer token', async () => {
      const result = await verifyAdminBearer({ authorization: 'Bearer ' });
      expect(result).toBeNull();
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
});
