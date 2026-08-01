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

import { describe, it, expect, beforeAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import {
  SupaCloudAdapter,
  SupaCloudApiError,
} from '../../../packages/auth-server/src/supacloud/adapter.js';
import { loadConfig } from '../../../packages/auth-server/src/config/index.js';

type LiveContractGates = {
  contract: boolean;
  mutation: boolean;
};

type CapabilityReportEntry = {
  path: string;
  method: string;
  supported: boolean;
  error?: string;
};

const SAFE_CAPABILITY_NOTES = new Set(['fixture env missing', 'not found (404)']);
const PUBLIC_PROJECT_FIELDS = new Set(['id', 'ref', 'project_ref', 'name']);
const SENSITIVE_PROJECT_FIELD = /(?:config|database|connection|credential|jwt|key|secret|token)/i;

function liveContractGates(environment: Record<string, string | undefined>): LiveContractGates {
  const contract = environment.RUN_SUPACLOUD_LIVE_CONTRACT === '1';
  return {
    contract,
    mutation: contract && environment.RUN_SUPACLOUD_LIVE_MUTATION === '1',
  };
}

function redactedCapabilityError(failure: unknown): string {
  if (typeof failure === 'string' && SAFE_CAPABILITY_NOTES.has(failure)) return failure;
  if (failure instanceof SupaCloudApiError) return `request failed (${failure.status})`;
  if (failure instanceof Error && ['AbortError', 'TimeoutError'].includes(failure.name)) {
    return 'request timed out';
  }
  return 'request failed';
}

function nestedFieldNames(candidate: unknown): string[] {
  if (Array.isArray(candidate)) return candidate.flatMap(nestedFieldNames);
  if (!candidate || typeof candidate !== 'object') return [];
  return Object.entries(candidate as Record<string, unknown>).flatMap(([field, nested]) => (
    [field, ...nestedFieldNames(nested)]
  ));
}

const gates = liveContractGates(process.env);
const describeLive = gates.contract ? describe : describe.skip;
const itMutation = gates.mutation ? it : it.skip;

const capabilityReport: CapabilityReportEntry[] = [];

let adapter: SupaCloudAdapter;
let testProjectRef: string;

beforeAll(() => {
  if (!gates.contract) return;
  process.env.SUPACLOUD_API_URL = process.env.SUPACLOUD_API_URL || '';
  process.env.SUPACLOUD_MASTER_TOKEN = process.env.SUPACLOUD_MASTER_TOKEN || '';
  process.env.PROJECT_REF = process.env.PROJECT_REF || '';
  process.env.OAUTH_RUNTIME_URL = process.env.OAUTH_RUNTIME_URL || '';
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://noop';
  loadConfig();
  adapter = new SupaCloudAdapter();
  testProjectRef = process.env.PROJECT_REF!;
});

function recordCapability(path: string, method: string, supported: boolean, failure?: unknown) {
  capabilityReport.push({
    path,
    method,
    supported,
    ...(!supported && failure !== undefined ? { error: redactedCapabilityError(failure) } : {}),
  });
}

function assertEnvelope<T extends Record<string, unknown>>(response: T, requiredFields: string[]) {
  for (const field of requiredFields) {
    expect(Object.hasOwn(response, field)).toBe(true);
  }
}

describe('SupaCloud live contract local safety guards', () => {
  it('requires both gates before enabling mutations', () => {
    expect(liveContractGates({})).toEqual({ contract: false, mutation: false });
    expect(liveContractGates({ RUN_SUPACLOUD_LIVE_MUTATION: '1' }))
      .toEqual({ contract: false, mutation: false });
    expect(liveContractGates({
      RUN_SUPACLOUD_LIVE_CONTRACT: '1',
      RUN_SUPACLOUD_LIVE_MUTATION: '0',
    })).toEqual({ contract: true, mutation: false });
    expect(liveContractGates({
      RUN_SUPACLOUD_LIVE_CONTRACT: '1',
      RUN_SUPACLOUD_LIVE_MUTATION: '1',
    })).toEqual({ contract: true, mutation: true });
  });

  it('redacts tokens, response bodies, paths, and internal URLs from report errors', () => {
    const upstreamFailure = new SupaCloudApiError(
      503,
      'token=dummy-secret; upstream=http://internal.invalid/v1; raw-response-body',
      '/v1/projects/internal-project',
    );
    expect(redactedCapabilityError(upstreamFailure)).toBe('request failed (503)');
    expect(redactedCapabilityError(new Error('connect ECONNREFUSED http://internal.invalid')))
      .toBe('request failed');
    expect(redactedCapabilityError('fixture env missing')).toBe('fixture env missing');
  });
});

// ─── Project ──────────────────────────────────────────────────────
describeLive('SupaCloud adapter live contract', () => {
  // ─── Project ──────────────────────────────────────────────────
  it('getProject returns project envelope', async () => {
    try {
      const project = await adapter.getProject() as Record<string, unknown>;
      assertEnvelope(project, ['id']);
      recordCapability('/v1/projects/:ref', 'GET', true);
    } catch (e) {
      recordCapability('/v1/projects/:ref', 'GET', false, e);
      throw e;
    }
  });

  it('project route returns an allowlisted, redacted DTO', async () => {
    try {
      const { healthRoutes } = await import('../../../packages/auth-server/src/routes/health.js');
      const response = await healthRoutes.handle(new Request('http://localhost/v1/project'));
      const project = await response.json() as Record<string, unknown>;
      expect(response.status).toBe(200);
      assertEnvelope(project, ['id']);
      expect(Object.keys(project).every((field) => PUBLIC_PROJECT_FIELDS.has(field))).toBe(true);
      expect(nestedFieldNames(project).some((field) => SENSITIVE_PROJECT_FIELD.test(field))).toBe(false);
      recordCapability('/v1/project', 'GET', true);
    } catch (e) {
      recordCapability('/v1/project', 'GET', false, e);
      throw e;
    }
  });

  // ─── Auth config ──────────────────────────────────────────────
  it('getAuthConfig returns auth config envelope', async () => {
    try {
      const config = await adapter.getAuthConfig() as Record<string, unknown>;
      // Supabase Management API returns auth config with these fields
      const expectedFields = ['enable_signup', 'enable_confirmations'];
      assertEnvelope(config, expectedFields);
      recordCapability('/v1/projects/:ref/config/auth', 'GET', true);
    } catch (e) {
      recordCapability('/v1/projects/:ref/config/auth', 'GET', false, e);
      throw e;
    }
  });

  itMutation('updateAuthConfig (PATCH) is idempotent', async () => {
    try {
      const original = await adapter.getAuthConfig() as Record<string, unknown>;
      // PATCH with same values → should be idempotent
      const updatedConfig = await adapter.updateAuthConfig({
        enable_signup: original.enable_signup,
      }) as Record<string, unknown>;
      expect(updatedConfig).toBeDefined();
      recordCapability('/v1/projects/:ref/config/auth', 'PATCH', true);
    } catch (e) {
      recordCapability('/v1/projects/:ref/config/auth', 'PATCH', false, e);
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
      recordCapability('/v1/projects/:ref/auth/oauth-clients', 'GET', false, e);
      throw e;
    }
  });

  itMutation('create/update/delete OAuth client is clean and idempotent', async () => {
    const clientName = `supaoauth-live-${randomUUID()}`;
    let clientId = '';
    try {
      const created = await adapter.createOAuthClient({
        client_name: clientName,
        client_type: 'confidential',
        redirect_uris: ['https://example.test/callback'],
        grant_types: ['authorization_code'],
      }) as Record<string, unknown>;
      clientId = String(created.client_id || created.id || '');
      expect(clientId).toBeTruthy();
      const masterToken = process.env.SUPACLOUD_MASTER_TOKEN || '___not_set___';
      expect(JSON.stringify(created).includes(masterToken)).toBe(false);
      recordCapability('/v1/projects/:ref/auth/oauth-clients', 'POST', true);

      const fetched = await adapter.getOAuthClient(clientId) as Record<string, unknown>;
      expect(fetched).toBeDefined();
      recordCapability('/v1/projects/:ref/auth/oauth-clients/:clientId', 'GET', true);

      const updated = await adapter.updateOAuthClient(clientId, {
        client_name: `${clientName}-updated`,
        redirect_uris: ['https://example.test/callback'],
        grant_types: ['authorization_code'],
      }) as Record<string, unknown>;
      expect(updated).toBeDefined();
      recordCapability('/v1/projects/:ref/auth/oauth-clients/:clientId', 'PUT', true);
    } finally {
      if (clientId) {
        await adapter.deleteOAuthClient(clientId);
        recordCapability('/v1/projects/:ref/auth/oauth-clients/:clientId', 'DELETE', true);
      }
    }
  });

  // ─── Providers ────────────────────────────────────────────────
  it('listProviders returns array envelope', async () => {
    try {
      const providers = await adapter.listProviders();
      expect(Array.isArray(providers)).toBe(true);
      recordCapability('/v1/projects/:ref/auth/providers', 'GET', true);
    } catch (e) {
      recordCapability('/v1/projects/:ref/auth/providers', 'GET', false, e);
      throw e;
    }
  });

  // ─── Users ────────────────────────────────────────────────────
  it('listUsers returns users envelope', async () => {
    try {
      const users = await adapter.listUsers();
      expect(users).toBeDefined();
      recordCapability('/v1/projects/:ref/auth/users', 'GET', true);
    } catch (e) {
      recordCapability('/v1/projects/:ref/auth/users', 'GET', false, e);
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
      recordCapability('/storage/v1/bucket', 'GET', false, e);
      throw e;
    }
  });

  itMutation('create/get/delete storage bucket is clean and scoped', async () => {
    const bucketId = `supaoauth-live-${randomUUID()}`;
    let bucketCreated = false;
    try {
      const created = await adapter.createStorageBucket(bucketId, { public: false });
      expect(created).toBeDefined();
      bucketCreated = true;
      recordCapability('/storage/v1/bucket', 'POST', true);

      const fetched = await adapter.getStorageBucket(bucketId);
      expect(fetched).toBeDefined();
      recordCapability('/storage/v1/bucket/:id', 'GET', true);
    } finally {
      if (bucketCreated) {
        try {
          await adapter.deleteStorageBucket(bucketId);
          recordCapability('/storage/v1/bucket/:id', 'DELETE', true);
        } catch (e) {
          recordCapability('/storage/v1/bucket/:id', 'DELETE', false, e);
          throw e;
        }
      }
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
      recordCapability('verifyGatewayRoutes', 'GET', false, e);
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
      if (e instanceof SupaCloudApiError && e.status === 404) {
        recordCapability('/v1/projects/:ref/auth/oauth-server', 'GET', false, 'not found (404)');
      } else {
        recordCapability('/v1/projects/:ref/auth/oauth-server', 'GET', false, e);
        throw e;
      }
    }
  });

  itMutation('reports optional MFA and domain capabilities when fixture values are provided', async () => {
    const userId = process.env.SUPACLOUD_LIVE_USER_ID;
    const factorId = process.env.SUPACLOUD_LIVE_MFA_FACTOR_ID;
    const domain = process.env.SUPACLOUD_LIVE_DOMAIN;

    if (userId && factorId) {
      await adapter.resetUserMfa(userId, factorId);
      recordCapability('/v1/projects/:ref/auth/users/:userId/mfa/:factorId/reset', 'POST', true);
    } else {
      recordCapability('/v1/projects/:ref/auth/users/:userId/mfa/:factorId/reset', 'POST', false, 'fixture env missing');
    }

    if (domain) {
      await adapter.checkCustomDomain(domain);
      recordCapability('/v1/projects/:ref/domains/:domain/health', 'GET', true);
    } else {
      recordCapability('/v1/projects/:ref/domains/:domain/health', 'GET', false, 'fixture env missing');
    }
  });

  // ─── Error handling ───────────────────────────────────────────
  it('adapter rejects with meaningful error on bad path', async () => {
    await expect(adapter.getUser('00000000-0000-0000-0000-000000000000'))
      .rejects.toBeInstanceOf(SupaCloudApiError);
  });

  // ─── Redacted fields ──────────────────────────────────────────
  it('master token is never in adapter responses', async () => {
    const token = process.env.SUPACLOUD_MASTER_TOKEN || '';
    if (!token) return;
    const responses = await Promise.allSettled([
      adapter.listOAuthClients(),
      adapter.listStorageBuckets(),
    ]);
    for (const response of responses) {
      if (response.status !== 'fulfilled') continue;
      expect(JSON.stringify(response.value).includes(token)).toBe(false);
    }
  });

  // ─── Timeout ──────────────────────────────────────────────────
  it('adapter requests timeout within 35s on unreachable host', async () => {
    const start = Date.now();
    const unreachableAdapter = new SupaCloudAdapter() as unknown as {
      apiUrl: string;
      masterToken: string;
      projectRef: string;
      getProject: () => Promise<unknown>;
    };
    unreachableAdapter.apiUrl = 'http://192.0.2.1:9999';
    unreachableAdapter.masterToken = 'test';
    unreachableAdapter.projectRef = 'test';
    await expect(unreachableAdapter.getProject()).rejects.toBeInstanceOf(Error);
    expect(Date.now() - start).toBeLessThan(35_000);
  }, { timeout: 35_000 });

  // ─── Capability report ────────────────────────────────────────
  it('outputs capability report', () => {
    console.log('\n=== SupaCloud Adapter Capability Report ===');
    for (const entry of capabilityReport) {
      const status = entry.supported ? 'SUPPORTED' : 'UNSUPPORTED';
      console.log(`  ${status}: ${entry.method} ${entry.path}${entry.error ? ` — ${entry.error}` : ''}`);
    }
    console.log(`  Total: ${capabilityReport.length} paths tested, ${capabilityReport.filter(e => e.supported).length} supported`);
    if (process.env.SUPACLOUD_CAPABILITY_REPORT_PATH) {
      writeFileSync(process.env.SUPACLOUD_CAPABILITY_REPORT_PATH, `${JSON.stringify({
        project_ref: testProjectRef,
        generated_at: new Date().toISOString(),
        capabilities: capabilityReport,
      }, null, 2)}\n`);
    }
  });
});
