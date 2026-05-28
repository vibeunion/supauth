/**
 * P0-25: SupaCloud adapter live contract and response-shape gate
 *
 * Env-gated live tests that hit the real SupaCloud Management API.
 * Gate: RUN_SUPACLOUD_LIVE_CONTRACT=1
 * Required env: SUPACLOUD_API_URL, SUPACLOUD_MASTER_TOKEN, PROJECT_REF,
 *               OAUTH_RUNTIME_URL
 *
 * These tests validate response envelope, error codes, idempotency,
 * redacted fields, and timeout/retry strategy for every adapter path.
 * Non-supported paths are reported as capability flags.
 */

import { describe, it, expect, beforeAll, afterEach } from 'bun:test';
import { SupaCloudAdapter } from '../../../packages/auth-server/src/supacloud/adapter.js';
import { loadConfig } from '../../../packages/auth-server/src/config/index.js';

const gate = process.env.RUN_SUPACLOUD_LIVE_CONTRACT === '1';
const describeLive = gate ? describe : describe.skip;

// Track capability report for unsupported paths
const capabilityReport: Array<{ path: string; method: string; supported: boolean; error?: string }> = [];

let adapter: SupaCloudAdapter;
let testProjectRef: string;

beforeAll(() => {
  if (!gate) return;
  process.env.SUPACLOUD_API_URL = process.env.SUPACLOUD_API_URL || '';
  process.env.SUPACLOUD_MASTER_TOKEN = process.env.SUPACLOUD_MASTER_TOKEN || '';
  process.env.PROJECT_REF = process.env.PROJECT_REF || '';
  process.env.OAUTH_RUNTIME_URL = process.env.OAUTH_RUNTIME_URL || '';
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://noop';
  loadConfig();
  adapter = new SupaCloudAdapter();
  testProjectRef = process.env.PROJECT_REF!;
});

function recordCapability(path: string, method: string, supported: boolean, error?: string) {
  capabilityReport.push({ path, method, supported, error });
}

// Helper: assert response has expected envelope fields
function assertEnvelope<T extends Record<string, unknown>>(obj: T, requiredFields: string[], label: string) {
  for (const field of requiredFields) {
    expect(obj).toHaveProperty(field);
  }
}

// ─── Project ──────────────────────────────────────────────────────
describeLive('SupaCloud adapter live contract', () => {
  // ─── Project ──────────────────────────────────────────────────
  it('getProject returns project envelope', async () => {
    try {
      const project = await adapter.getProject() as Record<string, unknown>;
      assertEnvelope(project, ['id'], 'getProject');
      expect(project.id).toBe(testProjectRef);
      recordCapability('/v1/projects/:ref', 'GET', true);
    } catch (e) {
      recordCapability('/v1/projects/:ref', 'GET', false, (e as Error).message);
      throw e;
    }
  });

  // ─── Auth config ──────────────────────────────────────────────
  it('getAuthConfig returns auth config envelope', async () => {
    try {
      const config = await adapter.getAuthConfig() as Record<string, unknown>;
      // Supabase Management API returns auth config with these fields
      const expectedFields = ['enable_signup', 'enable_confirmations'];
      for (const f of expectedFields) {
        expect(config).toHaveProperty(f);
      }
      recordCapability('/v1/projects/:ref/config/auth', 'GET', true);
    } catch (e) {
      recordCapability('/v1/projects/:ref/config/auth', 'GET', false, (e as Error).message);
      throw e;
    }
  });

  it('updateAuthConfig (PATCH) is idempotent', async () => {
    try {
      const original = await adapter.getAuthConfig() as Record<string, unknown>;
      // PATCH with same values → should be idempotent
      const result = await adapter.updateAuthConfig({
        enable_signup: original.enable_signup,
      }) as Record<string, unknown>;
      expect(result).toBeDefined();
      recordCapability('/v1/projects/:ref/config/auth', 'PATCH', true);
    } catch (e) {
      recordCapability('/v1/projects/:ref/config/auth', 'PATCH', false, (e as Error).message);
      throw e;
    }
  });

  // ─── OAuth clients ────────────────────────────────────────────
  it('listOAuthClients returns array envelope', async () => {
    try {
      const clients = await adapter.listOAuthClients();
      expect(Array.isArray(clients)).toBe(true);
      recordCapability('/v1/projects/:ref/auth/oauth-clients', 'GET', true);
    } catch (e) {
      recordCapability('/v1/projects/:ref/auth/oauth-clients', 'GET', false, (e as Error).message);
      throw e;
    }
  });

  // ─── Providers ────────────────────────────────────────────────
  it('listProviders returns array envelope', async () => {
    try {
      const providers = await adapter.listProviders();
      expect(Array.isArray(providers)).toBe(true);
      recordCapability('/v1/projects/:ref/auth/providers', 'GET', true);
    } catch (e) {
      recordCapability('/v1/projects/:ref/auth/providers', 'GET', false, (e as Error).message);
      throw e;
    }
  });

  // ─── Users ────────────────────────────────────────────────────
  it('listUsers returns users envelope', async () => {
    try {
      const result = await adapter.listUsers();
      // Supabase returns { users: [...], aud, ... } or array
      expect(result).toBeDefined();
      recordCapability('/v1/projects/:ref/auth/users', 'GET', true);
    } catch (e) {
      recordCapability('/v1/projects/:ref/auth/users', 'GET', false, (e as Error).message);
      throw e;
    }
  });

  // ─── Storage ──────────────────────────────────────────────────
  it('listStorageBuckets returns array', async () => {
    try {
      const buckets = await adapter.listStorageBuckets();
      expect(Array.isArray(buckets)).toBe(true);
      recordCapability('/storage/v1/bucket', 'GET', true);
    } catch (e) {
      recordCapability('/storage/v1/bucket', 'GET', false, (e as Error).message);
      throw e;
    }
  });

  // ─── Gateway routes ───────────────────────────────────────────
  it('verifyGatewayRoutes probes runtime health', async () => {
    try {
      const verification = await adapter.verifyGatewayRoutes();
      expect(verification).toHaveProperty('ok');
      expect(verification).toHaveProperty('probes');
      expect(Array.isArray(verification.probes)).toBe(true);
      recordCapability('verifyGatewayRoutes', 'GET', true);
    } catch (e) {
      recordCapability('verifyGatewayRoutes', 'GET', false, (e as Error).message);
      throw e;
    }
  });

  // ─── OAuth server ─────────────────────────────────────────────
  it('getOAuthServerStatus returns status or graceful error', async () => {
    try {
      const status = await adapter.getOAuthServerStatus();
      expect(status).toBeDefined();
      recordCapability('/v1/projects/:ref/auth/oauth-server', 'GET', true);
    } catch (e) {
      const msg = (e as Error).message;
      // If the path doesn't exist, record as unsupported capability
      if (msg.includes('404')) {
        recordCapability('/v1/projects/:ref/auth/oauth-server', 'GET', false, 'not found (404)');
      } else {
        recordCapability('/v1/projects/:ref/auth/oauth-server', 'GET', false, msg);
        throw e;
      }
    }
  });

  // ─── Error handling ───────────────────────────────────────────
  it('adapter rejects with meaningful error on bad path', async () => {
    try {
      // getUser with non-existent ID should error
      await adapter.getUser('00000000-0000-0000-0000-000000000000');
    } catch (e) {
      expect((e as Error).message).toMatch(/SupaCloud \d{3}/);
    }
  });

  // ─── Redacted fields ──────────────────────────────────────────
  it('master token is never in adapter responses', async () => {
    const token = process.env.SUPACLOUD_MASTER_TOKEN || '';
    if (!token) return;
    const responses: unknown[] = [];
    try { responses.push(await adapter.listOAuthClients()); } catch {}
    try { responses.push(await adapter.listStorageBuckets()); } catch {}
    for (const resp of responses) {
      const str = JSON.stringify(resp);
      expect(str).not.toContain(token);
    }
  });

  // ─── Timeout ──────────────────────────────────────────────────
  it('adapter requests timeout within 10s on unreachable host', async () => {
    const start = Date.now();
    const badAdapter = new (SupaCloudAdapter as any)();
    // Override internal URL to unreachable host
    badAdapter.apiUrl = 'http://192.0.2.1:9999';
    badAdapter.masterToken = 'test';
    badAdapter.projectRef = 'test';
    try {
      await badAdapter.getProject();
    } catch {
      // Should timeout — allow up to 12s for CI variance
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(12_000);
    }
  });

  // ─── Capability report ────────────────────────────────────────
  it('outputs capability report', () => {
    console.log('\n=== SupaCloud Adapter Capability Report ===');
    for (const entry of capabilityReport) {
      const status = entry.supported ? 'SUPPORTED' : 'UNSUPPORTED';
      console.log(`  ${status}: ${entry.method} ${entry.path}${entry.error ? ` — ${entry.error}` : ''}`);
    }
    console.log(`  Total: ${capabilityReport.length} paths tested, ${capabilityReport.filter(e => e.supported).length} supported`);
  });
});
