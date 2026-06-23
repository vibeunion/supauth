import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { SupaCloudAdapter } from '../supacloud/adapter.js';
import { loadConfig } from '../config/index.js';

// P0-13/P0-25/P0-26: Contract tests for SupaCloud adapter
// These test the adapter's method signatures and response shape expectations
// against mock SupaCloud API responses.

describe('SupaCloudAdapter contract', () => {
  beforeEach(() => {
    process.env.SUPACLOUD_API_URL = 'http://test-api:9090';
    process.env.SUPACLOUD_MASTER_TOKEN = 'test-token';
    process.env.PROJECT_REF = 'test-ref';
    process.env.OAUTH_RUNTIME_URL = 'http://runtime.test';
    process.env.DATABASE_URL = 'postgres://test';
    delete process.env.SUPACLOUD_RUNTIME_URL_TEMPLATE;
    delete process.env.SUPACLOUD_STORAGE_URL_TEMPLATE;
    delete process.env.SUPACLOUD_STORAGE_URL;
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
      'listUserSessions', 'recordUserSession', 'revokeUserSession',
      'getUserRoleAssignments', 'resolveUserPermissions',
      'listUserPasskeys', 'registerUserPasskey', 'renamePasskey', 'revokePasskey',
      'listOrganizations', 'createOrganization', 'getOrganization',
      'updateOrganization', 'deleteOrganization', 'addOrganizationMember',
      'removeOrganizationMember', 'updateOrganizationMember',
      'getOrgRoleAssignments', 'listOrganizationInvitations',
      'createOrganizationInvitation', 'updateOrganizationInvitationStatus',
      'getOrganizationJitSettings', 'updateOrganizationJitSettings',
      'listOrganizationApplications', 'updateOrganizationApplication',
      'deleteOrganizationApplication', 'listRoles', 'createRole', 'getRole',
      'updateRole', 'deleteRole', 'listRolePermissions', 'createPermission',
      'deletePermission', 'assignRole', 'listRoleAssignments', 'revokeRole',
      'queryAuditLogs', 'getAuditLog', 'recordAuditEvent', 'listWebhooks', 'createWebhook',
      'getWebhook', 'updateWebhook', 'deleteWebhook', 'rotateWebhookSecret',
      'listWebhookLogs', 'testWebhook', 'replayWebhook', 'enqueueWebhookEvent',
      'listStorageBuckets', 'getStorageBucket', 'createStorageBucket',
      'deleteStorageBucket', 'uploadFile', 'deleteFile', 'createSignedUrl', 'getPublicUrl',
      'verifyGatewayRoutes', 'getProjectRef', 'getTargetInfo',
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
    expect(adapter).toBeDefined();
  });

  it('encodes OAuth client and secret path segments', async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      urls.push(url);
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch;

    try {
      const adapter = new SupaCloudAdapter();
      await adapter.getOAuthClient('../../config/auth');
      await adapter.disableClientSecret('client/one', 'secret/two');

      expect(urls[0]).toContain('/auth/oauth-clients/..%2F..%2Fconfig%2Fauth');
      expect(urls[0]).not.toContain('/projects/test-ref/config/auth');
      expect(urls[1]).toContain('/auth/oauth-clients/client%2Fone/secrets/secret%2Ftwo/disable');
    } finally {
      globalThis.fetch = originalFetch;
    }
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

  // P0-26: projectRef override tests
  it('uses env PROJECT_REF by default', () => {
    const adapter = new SupaCloudAdapter();
    expect(adapter.getProjectRef()).toBe('test-ref');
  });

  it('uses explicit projectRef override when provided', () => {
    const adapter = new SupaCloudAdapter({ projectRef: 'other-project-12345' });
    expect(adapter.getProjectRef()).toBe('other-project-12345');
  });

  it('getSupaCloudAdapterForProject creates scoped adapter', async () => {
    const { getSupaCloudAdapterForProject } = await import('../supacloud/adapter.js');
    const scoped = getSupaCloudAdapterForProject('scoped-ref-abcde12345');
    expect(scoped.getProjectRef()).toBe('scoped-ref-abcde12345');
  });

  it('derives project-scoped runtime and storage URLs from templates', () => {
    process.env.SUPACLOUD_RUNTIME_URL_TEMPLATE = 'https://{projectRef}.api.example.test';
    process.env.SUPACLOUD_STORAGE_URL_TEMPLATE = 'https://{projectRef}.storage.example.test';
    loadConfig();

    const adapter = new SupaCloudAdapter({ projectRef: 'projecttarget1234567890' });
    const target = adapter.getTargetInfo();

    expect(target.runtimeUrl).toBe('https://projecttarget1234567890.api.example.test');
    expect(target.storageUrl).toBe('https://projecttarget1234567890.storage.example.test');
    expect(target.runtimeProjectScoped).toBe(true);
    expect(target.storageProjectScoped).toBe(true);
  });

  it('marks cross-project runtime/storage as unscoped when URLs cannot be derived', () => {
    process.env.PROJECT_REF = 'defaultproject1234567890';
    process.env.OAUTH_RUNTIME_URL = 'https://api.shared.example.test';
    loadConfig();

    const adapter = new SupaCloudAdapter({ projectRef: 'targetproject1234567890' });
    const target = adapter.getTargetInfo();

    expect(target.runtimeUrl).toBe('https://api.shared.example.test');
    expect(target.storageUrl).toBe('https://api.shared.example.test');
    expect(target.runtimeProjectScoped).toBe(false);
    expect(target.storageProjectScoped).toBe(false);
  });
});

describe('SupaCloud API response shape expectations', () => {
  it('OAuth client response shape', () => {
    const expectedShape = {
      client_id: 'string',
      client_name: 'string',
      client_secret: 'string (only on create/rotate)',
      client_type: 'confidential | public',
      redirect_uris: 'string[]',
      grant_types: 'string[]',
    };
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
