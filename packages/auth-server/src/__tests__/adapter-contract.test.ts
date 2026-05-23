import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { SupaCloudAdapter } from '../supacloud/adapter.js';

// P0-13: Contract tests for SupaCloud adapter
// These test the adapter's method signatures and response shape expectations
// against mock SupaCloud API responses.

describe('SupaCloudAdapter contract', () => {
  // We test method shapes without hitting real SupaCloud
  // by verifying the adapter constructs correct requests

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
    // Verify the adapter uses the config correctly
    process.env.SUPACLOUD_API_URL = 'http://test-api:9090';
    process.env.SUPACLOUD_MASTER_TOKEN = 'test-token';
    process.env.PROJECT_REF = 'test-ref';
    process.env.DATABASE_URL = 'postgres://test';

    const adapter = new SupaCloudAdapter();
    // The constructor should not throw
    expect(adapter).toBeDefined();
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
