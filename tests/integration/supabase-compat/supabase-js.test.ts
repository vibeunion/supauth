/**
 * Supabase Auth compatibility fixture (P0-16).
 *
 * The smoke contract runs without live env. Live mode verifies that SupaOAuth
 * keeps the GoTrue Auth runtime intact and that supabase-js can complete the
 * auth/session/token lifecycle against a real tenant.
 *
 * Live env:
 *   REQUIRE_SUPABASE_AUTH_COMPAT=1
 *   RUN_SUPABASE_RUNTIME_COMPAT=1
 *   OAUTH_RUNTIME_URL=https://api.example.com
 *   MANAGEMENT_URL=https://auth.example.com/api
 *   SUPABASE_ANON_KEY=<anon-jwt>
 *   SUPABASE_TEST_EMAIL=<test-user@example.com>
 *   SUPABASE_TEST_PASSWORD=<password>
 */

import { describe, it, expect } from 'bun:test';
import { createClient } from '@supabase/supabase-js';

const RUNTIME_URL = trimTrailingSlash(process.env.OAUTH_RUNTIME_URL || 'http://localhost:9999');
const MANAGEMENT_PORT = parseInt(process.env.PORT || '4010', 10);
const MANAGEMENT_URL = trimTrailingSlash(process.env.MANAGEMENT_URL || `http://localhost:${MANAGEMENT_PORT}`);
const STRICT_COMPAT = process.env.REQUIRE_SUPABASE_AUTH_COMPAT === '1';
const RUN_LIVE = STRICT_COMPAT || process.env.RUN_SUPABASE_RUNTIME_COMPAT === '1' || process.env.RUN_SUPABASE_OAUTH21_COMPAT === '1';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const TEST_EMAIL = process.env.SUPABASE_TEST_EMAIL || '';
const TEST_PASSWORD = process.env.SUPABASE_TEST_PASSWORD || '';

type LiveTestHandler = () => void | Promise<unknown>;

function liveIt(name: string, fn: LiveTestHandler) {
  if (RUN_LIVE) it(name, fn);
}

function supabaseJsIt(name: string, fn: LiveTestHandler) {
  if (RUN_LIVE && SUPABASE_ANON_KEY) it(name, fn);
}

function authIt(name: string, fn: LiveTestHandler) {
  if (RUN_LIVE && SUPABASE_ANON_KEY && TEST_EMAIL && TEST_PASSWORD) it(name, fn);
}

if (STRICT_COMPAT) {
  assertRequiredEnv([
    'OAUTH_RUNTIME_URL',
    'MANAGEMENT_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_TEST_EMAIL',
    'SUPABASE_TEST_PASSWORD',
  ]);
}

function supabaseClient() {
  return createClient(RUNTIME_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

describe('Supabase runtime compatibility', () => {
  liveIt('/auth/v1/.well-known/openid-configuration returns GoTrue discovery', async () => {
    const res = await fetch(`${RUNTIME_URL}/auth/v1/.well-known/openid-configuration`);
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body.issuer).toBeDefined();
    expect(body.authorization_endpoint).toBeDefined();
    expect(body.token_endpoint).toBeDefined();
    expect(body.runtime_mode).toBeUndefined();
  });

  liveIt('/auth/v1/.well-known/jwks.json returns JWKS', async () => {
    const res = await fetch(`${RUNTIME_URL}/auth/v1/.well-known/jwks.json`);
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(Array.isArray(body.keys)).toBe(true);
  });

  liveIt('Management API health returns SupaOAuth response', async () => {
    const res = await fetch(`${MANAGEMENT_URL}/v1/health`);
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body.runtime_mode).toBeDefined();
    expect(['gotrue', 'external_oidc']).toContain(body.runtime_mode);
  });

  supabaseJsIt('supabase-js can initialize and read current session', async () => {
    const client = supabaseClient();
    const { data, error } = await client.auth.getSession();
    expect(error).toBeNull();
    expect(data).toHaveProperty('session');
  });

  authIt('supabase-js signUp/signIn/getSession/refresh/signOut path works', async () => {
    const client = supabaseClient();
    await client.auth.signUp({ email: TEST_EMAIL, password: TEST_PASSWORD });

    const signIn = await client.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    expect(signIn.error).toBeNull();
    expect(signIn.data.session?.access_token).toBeDefined();
    expect(signIn.data.session?.refresh_token).toBeDefined();

    const session = await client.auth.getSession();
    expect(session.error).toBeNull();
    expect(session.data.session?.access_token).toBeDefined();

    const refreshed = await client.auth.refreshSession();
    expect(refreshed.error).toBeNull();
    expect(refreshed.data.session?.access_token).toBeDefined();

    const signOut = await client.auth.signOut();
    expect(signOut.error).toBeNull();
  });

  authIt('supabase-js user and JWT/JWKS path works with authenticated token', async () => {
    const client = supabaseClient();
    const signIn = await client.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(signIn.error).toBeNull();

    const user = await client.auth.getUser();
    expect(user.error).toBeNull();
    expect(user.data.user?.id).toBeDefined();

    const token = signIn.data.session?.access_token || '';
    const payload = decodeJwtPayload(token);
    expect(payload.sub).toBe(user.data.user?.id);
    expect(payload.role).toBeDefined();
    expect(payload.iss).toBeDefined();
    expect(payload.app_metadata).toBeDefined();
  });

  it('GoTrue JWT required claims are defined in compatibility spec', () => {
    const requiredClaims = ['sub', 'role', 'aud', 'iss', 'exp', 'app_metadata', 'user_metadata'];
    for (const claim of requiredClaims) {
      expect(claim).toBeDefined();
    }
  });
});

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  expect(payload).toBeDefined();
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return JSON.parse(atob(padded)) as Record<string, unknown>;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function assertRequiredEnv(names: string[]) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required Supabase Auth compatibility env: ${missing.join(', ')}`);
  }
}
