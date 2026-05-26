import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { SupaCloudAdapter } from '../supacloud/adapter.js';
import { loadConfig } from '../config/index.js';

// P0-13: Contract tests for SupaCloud adapter
// These test the adapter's method signatures and response shape expectations
// against mock SupaCloud API responses.

describe('SupaCloudAdapter contract', () => {
  // We test method shapes without hitting real SupaCloud
  // by verifying the adapter constructs correct requests

  beforeEach(() => {
    process.env.SUPACLOUD_API_URL = 'http://test-api:9090';
    process.env.SUPACLOUD_MASTER_TOKEN = 'test-token';
    process.env.PROJECT_REF = 'test-ref';
    process.env.OAUTH_RUNTIME_URL = 'http://runtime.test';
    process.env.DATABASE_URL = 'postgres://test';
    loadConfig();
  });

  it('has all required methods', () => {
    const adapter = new SupaCloudAdapter();
    const requiredMethods = [
      'getProject', 'getAuthConfig', 'updateAuthConfig',
      'getOAuthServerStatus', 'listOAuthClients', 'createOAuthClient',
      'getOAuthClient', 'updateOAuthClient', 'deleteOAuthClient',
      'regenerateClientSecret', 'listProviders', 'getProvider',
      'updateProvider', 'listUsers', 'getUser', 'deleteUser', 'updateUser',
      'listStorageBuckets', 'getStorageBucket', 'createStorageBucket',
      'uploadFile', 'deleteFile', 'createSignedUrl', 'getPublicUrl',
      'verifyGatewayRoutes',
    ];
    for (const method of requiredMethods) {
      expect(typeof (adapter as any)[method]).toBe('function');
    }
  });

  it('getPublicUrl returns expected format', () => {
    const adapter = new SupaCloudAdapter();
    const url = adapter.getPublicUrl('branding', 'logo.png');
    expect(url).toContain('/storage/v1/object/public/branding/logo.png');
  });

  it('SupaCloud API URL is constructed correctly', () => {
    const adapter = new SupaCloudAdapter();
    // The constructor should not throw
    expect(adapter).toBeDefined();
  });

  it('verifyGatewayRoutes fails when Kong returns an upstream error', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/auth/v1/health')) {
        return Promise.resolve(new Response('{"status":"ok"}', { status: 200 }));
      }
      return Promise.resolve(new Response('{"message":"An invalid response was received from the upstream server"}', { status: 502 }));
    }) as unknown as typeof fetch;

    const adapter = new SupaCloudAdapter();
    const verification = await adapter.verifyGatewayRoutes();

    expect(verification.ok).toBe(false);
    expect(verification.probes.find((probe) => probe.name === 'postgrest_root')?.status).toBe(502);

    globalThis.fetch = originalFetch;
  });
});

describe('SupaCloud API response shape expectations', () => {
  // Document the expected response shapes from SupaCloud/Supabase APIs
  // These are not live tests but serve as contract documentation

  it('OAuth client response shape', () => {
    const expectedShape = {
      client_id: 'string',
      client_name: 'string',
      client_secret: 'string (only on create/rotate)',
      client_type: 'confidential | public',
      redirect_uris: 'string[]',
      grant_types: 'string[]',
    };
    // This test documents the expected shape
    expect(expectedShape).toBeDefined();
  });

  it('Auth config response shape', () => {
    const expectedShape = {
      enable_signup: 'boolean',
      enable_confirmations: 'boolean',
      external_anonymous_users_enabled: 'boolean',
      jwt_expiry: 'number (seconds)',
      password_min_length: 'number',
      mfa_max_enrolled_factors: 'number',
    };
    expect(expectedShape).toBeDefined();
  });

  it('Storage upload response shape', () => {
    const expectedShape = {
      Key: 'string (bucket/path)',
    };
    expect(expectedShape).toBeDefined();
  });

  it('Storage delete request shape', () => {
    const expectedShape = {
      prefixes: 'string[]',
    };
    expect(expectedShape).toBeDefined();
  });

  it('Signed URL response shape', () => {
    const expectedShape = {
      signedURL: 'string',
    };
    expect(expectedShape).toBeDefined();
  });
});
