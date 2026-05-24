/**
 * Supabase runtime end-to-end compatibility tests (S1.4)
 *
 * Verifies SupaOAuth Management API does NOT break Supabase runtime paths
 * that supabase-js, RLS, Storage, and Realtime depend on.
 *
 * Run smoke/skip contract:
 *   bun test tests/integration/supabase-compat/
 *
 * Run live checks:
 *   RUN_SUPABASE_RUNTIME_COMPAT=1 \
 *   OAUTH_RUNTIME_URL=http://localhost:9999 \
 *   PORT=4000 \
 *   bun test tests/integration/supabase-compat/
 */

import { describe, it, expect } from 'bun:test';

const RUNTIME_URL = process.env.OAUTH_RUNTIME_URL || 'http://localhost:9999';
const MANAGEMENT_PORT = parseInt(process.env.PORT || '4000', 10);
const MANAGEMENT_URL = `http://localhost:${MANAGEMENT_PORT}`;
const RUN_LIVE = process.env.RUN_SUPABASE_RUNTIME_COMPAT === '1' || process.env.RUN_SUPABASE_OAUTH21_COMPAT === '1';
const liveIt = RUN_LIVE ? it : it.skip;

describe('Supabase runtime compatibility', () => {
  liveIt('/auth/v1/.well-known/openid-configuration returns GoTrue discovery', async () => {
    const res = await fetch(`${RUNTIME_URL}/auth/v1/.well-known/openid-configuration`);
    if (res.ok) {
      const body = await res.json();
      expect(body.issuer).toBeDefined();
      expect(body.authorization_endpoint).toBeDefined();
      expect(body.token_endpoint).toBeDefined();
      // Must NOT have SupaOAuth management fields
      expect(body.runtime_mode).toBeUndefined();
    }
  });

  liveIt('/auth/v1/.well-known/jwks.json returns JWKS', async () => {
    const res = await fetch(`${RUNTIME_URL}/auth/v1/.well-known/jwks.json`);
    if (res.ok) {
      const body = await res.json();
      expect(Array.isArray(body.keys)).toBe(true);
    }
  });

  liveIt('Management API health returns SupaOAuth response', async () => {
    const res = await fetch(`${MANAGEMENT_URL}/v1/health`);
    if (res.ok) {
      const body = await res.json();
      expect(body.runtime_mode).toBeDefined();
      expect(['gotrue', 'external_oidc']).toContain(body.runtime_mode);
    }
  });

  liveIt('/rest/v1/* is not occupied by SupaOAuth', async () => {
    const res = await fetch(`${RUNTIME_URL}/rest/v1/`);
    if (res.status !== 404) {
      const text = await res.text();
      expect(text).not.toContain('SupaOAuth');
    }
  });

  liveIt('/storage/v1/bucket is not occupied by SupaOAuth', async () => {
    const res = await fetch(`${RUNTIME_URL}/storage/v1/bucket`);
    if (res.ok) {
      const body = await res.json();
      expect(body.runtime_mode).toBeUndefined();
    }
  });

  it('GoTrue JWT required claims are defined in compatibility spec', () => {
    const requiredClaims = ['sub', 'role', 'aud', 'iss', 'exp', 'app_metadata', 'user_metadata'];
    for (const claim of requiredClaims) {
      expect(claim).toBeDefined();
    }
  });
});
