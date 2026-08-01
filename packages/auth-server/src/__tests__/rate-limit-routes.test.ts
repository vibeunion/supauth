import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';
import { loadConfig } from '../config/index.js';
import {
  BoundedExpiringMap,
  BoundedFixedWindowLimiter,
  resolveClientIp,
  SHARED_CLIENT_KEY,
} from '../utils/rate-limit.js';

const getSecurityConfig = mock(async () => null);
mock.module('../repositories/security-config.js', () => ({ getSecurityConfig }));

process.env.ADMIN_AUTH_MODE = 'token';
process.env.ADMIN_MAX_LOGIN_ATTEMPTS = '100';
process.env.ADMIN_RATE_LIMIT_RPM = '1';
process.env.ADMIN_TOKEN = 'expected-admin-token';
process.env.NODE_ENV = 'test';

const { adminAuthGuard, authRoutes } = await import('../auth/index.js');
const { createPublicAccountClaimRoutes, sanitizeAccountClaimConfig } = await import('../routes/account-provisioning.js');
const { createPublicAccountPasswordRoutes } = await import('../routes/account-password.js');
const { sanitizeAccountCenterConfig } = await import('../routes/account-self-service.js');

describe('client IP normalization and bounded fixed windows', () => {
  it('uses one conservative key unless trusted proxy headers contain a valid IP', () => {
    expect(resolveClientIp({ 'x-forwarded-for': '203.0.113.7, 198.51.100.4' }, false)).toBe(SHARED_CLIENT_KEY);
    expect(resolveClientIp({ 'x-real-ip': '203.0.113.8' }, false)).toBe(SHARED_CLIENT_KEY);
    expect(resolveClientIp({ 'x-forwarded-for': ' 203.0.113.7 , 198.51.100.4' }, true)).toBe('203.0.113.7');
    expect(resolveClientIp({ 'x-real-ip': '2001:0DB8:0000:0000:0000:0000:0000:0001' }, true)).toBe('2001:db8::1');
    expect(resolveClientIp({ 'x-forwarded-for': 'not-an-ip', 'x-real-ip': '198.51.100.4' }, true)).toBe('198.51.100.4');
    expect(resolveClientIp({ 'x-forwarded-for': 'fe80::1%lo0' }, true)).toBe(SHARED_CLIENT_KEY);
    expect(resolveClientIp({ 'x-forwarded-for': ' ', 'x-real-ip': '' }, true)).toBe(SHARED_CLIENT_KEY);
  });

  it('keeps a hot key when capacity is full instead of evicting it', () => {
    const limiter = new BoundedFixedWindowLimiter({ windowMs: 1_000, maxEntries: 3, now: () => 0 });

    expect(limiter.consume('hot-key', 2)).toBe(true);
    expect(limiter.consume('cold-key-1', 2)).toBe(true);
    expect(limiter.consume('cold-key-2', 2)).toBe(true);
    expect(limiter.consume('new-key', 2)).toBe(false);
    expect(limiter.consume('hot-key', 2)).toBe(true);
    expect(limiter.consume('hot-key', 2)).toBe(false);
    expect(limiter.trackedKeyCount).toBe(3);
  });

  it('bounds ten thousand high-cardinality keys and cleans expired entries', () => {
    let now = 0;
    const limiter = new BoundedFixedWindowLimiter({ windowMs: 1_000, now: () => now });
    let acceptedAllCapacityKeys = true;

    for (let index = 0; index < 10_000; index += 1) {
      acceptedAllCapacityKeys = limiter.consume(`client-${index}`, 1) && acceptedAllCapacityKeys;
    }
    expect(acceptedAllCapacityKeys).toBe(true);
    expect(limiter.trackedKeyCount).toBe(10_000);
    expect(limiter.consume('overflow-client', 1)).toBe(false);

    now = 1_000;
    expect(limiter.consume('after-expiry', 1)).toBe(true);
    expect(limiter.trackedKeyCount).toBe(1);
  });

  it('keeps expiring state bounded without evicting a live key', () => {
    let now = 0;
    const states = new BoundedExpiringMap<{ count: number }>({ maxEntries: 2, now: () => now });

    expect(states.set('hot-key', { count: 1 }, 1_000)).toBe(true);
    expect(states.set('cold-key', { count: 1 }, 1_000)).toBe(true);
    expect(states.set('overflow-key', { count: 1 }, 1_000)).toBe(false);
    expect(states.get('hot-key')).toEqual({ count: 1 });

    now = 1_000;
    expect(states.get('hot-key')).toBeUndefined();
    expect(states.set('after-expiry', { count: 1 }, 1_000)).toBe(true);
    expect(states.trackedKeyCount).toBe(1);
  });
});

function configureProxyTrust(trusted: boolean): void {
  process.env.TRUST_PROXY_HEADERS = String(trusted);
  loadConfig();
}

function passwordChangeRequest(forwardedFor: string): Request {
  return new Request('http://localhost/v1/public/account-password/change', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedFor },
    body: JSON.stringify({
      email: 'rate-limit@example.test',
      current_password: 'OldPass123!',
      new_password: 'NewPass123!',
    }),
  });
}

function accountClaimRequest(forwardedFor: string): Request {
  return new Request('http://localhost/v1/public/account-claims/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedFor },
    body: JSON.stringify({
      display_name: '张三',
      external_id: 'rate-limit-employee',
      external_type: 'employee',
      claim_proof: 'claim-proof-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    }),
  });
}

function adminRequest(forwardedFor: string): Request {
  return new Request('http://localhost/v1/protected-rate-limit-probe', {
    headers: { 'x-forwarded-for': forwardedFor },
  });
}

function adminLoginRequest(forwardedFor: string): Request {
  return new Request('http://localhost/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedFor },
    body: JSON.stringify({ token: 'invalid-admin-token' }),
  });
}

function benchmarkClientIp(index: number): string {
  return `198.18.${Math.floor(index / 256)}.${index % 256}`;
}

describe('forwarded client IP rate-limit boundaries', () => {
  beforeEach(() => {
    configureProxyTrust(false);
  });

  it('does not let forwarded header rotation bypass the Admin limit when proxy headers are untrusted', async () => {
    const app = new Elysia()
      .use(adminAuthGuard)
      .get('/v1/protected-rate-limit-probe', () => ({ ok: true }));
    const statuses: number[] = [];

    for (const forwardedFor of ['192.0.2.10', '192.0.2.11']) {
      const response = await app.handle(adminRequest(forwardedFor));
      statuses.push(response.status);
    }

    expect(statuses).toEqual([401, 429]);
  });

  it('keeps trusted, valid proxy addresses as separate Admin limit keys', async () => {
    configureProxyTrust(true);
    const app = new Elysia()
      .use(adminAuthGuard)
      .get('/v1/protected-rate-limit-probe', () => ({ ok: true }));
    const statuses: number[] = [];

    for (const forwardedFor of ['198.51.100.10', '198.51.100.11']) {
      const response = await app.handle(adminRequest(forwardedFor));
      statuses.push(response.status);
    }

    expect(statuses).toEqual([401, 401]);
  });

  it('does not let forwarded header rotation bypass the account claim limit', async () => {
    const claimIps: string[] = [];
    const app = new Elysia().use(createPublicAccountClaimRoutes({
      getConfig: async () => sanitizeAccountClaimConfig({ enabled: true, value: {} }),
      claimAccount: async (input) => {
        claimIps.push(input.ip || '');
        return { status: 'unavailable' };
      },
    }));
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 13; attempt += 1) {
      const response = await app.handle(accountClaimRequest(`203.0.113.${attempt + 1}`));
      statuses.push(response.status);
    }

    expect(statuses).toEqual([...Array(12).fill(409), 429]);
    expect(claimIps).toEqual(Array(12).fill(SHARED_CLIENT_KEY));
  });

  it('does not let forwarded header rotation bypass the password change limit', async () => {
    let accountConfigReads = 0;
    let authConfigReads = 0;
    let passwordChanges = 0;
    const app = new Elysia().use(createPublicAccountPasswordRoutes({
      getAccountCenterConfig: async () => {
        accountConfigReads += 1;
        return sanitizeAccountCenterConfig({
          enabled: true,
          value: { security: { password_change: true } },
        });
      },
      getAuthConfig: async () => {
        authConfigReads += 1;
        return {
          password_min_length: 6,
          password_required_characters: '',
        };
      },
      changePassword: async () => {
        passwordChanges += 1;
        return { ok: true };
      },
    }));
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 9; attempt += 1) {
      const response = await app.handle(passwordChangeRequest(`203.0.113.${attempt + 1}`));
      statuses.push(response.status);
    }

    expect(statuses).toEqual([...Array(8).fill(200), 429]);
    expect(accountConfigReads).toBe(9);
    expect(authConfigReads).toBe(8);
    expect(passwordChanges).toBe(8);
  });

  it('bounds more than ten thousand trusted login-failure keys without evicting a hot key', async () => {
    configureProxyTrust(true);
    const app = new Elysia().use(authRoutes);
    let acceptedAllCapacityKeys = true;

    for (let index = 0; index < 10_000; index += 1) {
      const response = await app.handle(adminLoginRequest(benchmarkClientIp(index)));
      acceptedAllCapacityKeys = response.status === 200 && acceptedAllCapacityKeys;
    }

    expect(acceptedAllCapacityKeys).toBe(true);
    const overflowResponse = await app.handle(adminLoginRequest(benchmarkClientIp(10_000)));
    expect(overflowResponse.status).toBe(429);

    const hotKeyResponse = await app.handle(adminLoginRequest(benchmarkClientIp(0)));
    expect(hotKeyResponse.status).toBe(200);
  });
});
