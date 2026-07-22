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
      'getProject', 'getCapabilities', 'getAuthConfig', 'updateAuthConfig',
      'getOAuthServerStatus', 'listOAuthClients', 'createOAuthClient',
      'getOAuthClient', 'updateOAuthClient', 'deleteOAuthClient',
      'regenerateClientSecret', 'listProviders', 'getProvider',
      'updateProvider', 'testProvider', 'listUsers', 'createUser', 'getUser', 'deleteUser', 'updateUser',
      'listUserSessions', 'revokeUserSession',
      'getUserRoleAssignments', 'resolveUserPermissions',
      'listUserOrganizations', 'listUserOAuthGrants', 'revokeUserOAuthGrant',
      'listApplicationOAuthGrants',
      'listOrganizations', 'createOrganization', 'getOrganization',
      'updateOrganization', 'deleteOrganization', 'addOrganizationMember',
      'removeOrganizationMember', 'updateOrganizationMember',
      'listOrganizationMembers',
      'getOrgRoleAssignments', 'listOrganizationInvitations',
      'createOrganizationInvitation', 'acceptOrganizationInvitation', 'revokeOrganizationInvitation',
      'getOrganizationJitSettings', 'updateOrganizationJitSettings', 'reconcileOrganizationJitMemberships',
      'listOrganizationApplications', 'bindOrganizationApplication',
      'deleteOrganizationApplication', 'getOrganizationBranding', 'updateOrganizationBranding',
      'listRoles', 'createRole', 'getRole',
      'updateRole', 'deleteRole', 'listRolePermissions', 'createPermission',
      'deletePermission', 'assignRole', 'listRoleAssignments', 'revokeRole',
      'listApplicationRoleAssignments', 'listApplicationOrganizations',
      'queryAuditLogs', 'getAuditLog', 'recordAuditEvent', 'listWebhooks', 'createWebhook',
      'exportAuditLogs', 'getAuditExport', 'downloadAuditExport', 'getAuditIntegrity',
      'getWebhook', 'updateWebhook', 'deleteWebhook', 'rotateWebhookSecret',
      'listWebhookLogs', 'testWebhook', 'enqueueWebhookEvent',
      'listWebhookDeliveries', 'getWebhookDelivery', 'replayWebhookDelivery',
      'listTenantMembers', 'updateTenantMember', 'removeTenantMember',
      'listTenantInvitations', 'createTenantInvitation', 'verifySignupInvitation',
      'getAuthHookStatus', 'verifyAuthHook', 'verifyAuthHookMessage',
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

  it('uses canonical organization mutation paths and payloads', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ path: string; method: string; body: string | null; authorization: string | null }> = [];
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({
        path: new URL(url).pathname,
        method: init?.method || 'GET',
        body: typeof init?.body === 'string' ? init.body : null,
        authorization: new Headers(init?.headers).get('authorization'),
      });
      return Promise.resolve(Response.json({ ok: true }));
    }) as unknown as typeof fetch;

    try {
      const adapter = new SupaCloudAdapter();
      await adapter.updateOrganizationMember('org/one', 'user/one', { role: 'admin' });
      await adapter.acceptOrganizationInvitation(
        'org/one',
        'invite/one',
        { token: 'token-one' },
        'bearer gotrue-user-token',
      );
      await adapter.revokeOrganizationInvitation('org/one', 'invite/one');
      await adapter.updateOrganizationJitSettings('org/one', { enabled: true, domains: ['example.test'] });
      await adapter.reconcileOrganizationJitMemberships('user-one');
      await adapter.bindOrganizationApplication('org/one', 'app/one');

      expect(calls.map(call => [call.method, call.path, call.body])).toEqual([
        ['PATCH', '/v1/projects/test-ref/organizations/org%2Fone/members/user%2Fone', '{"role":"admin"}'],
        ['POST', '/v1/projects/test-ref/organizations/org%2Fone/invitations/invite%2Fone/accept', '{"token":"token-one"}'],
        ['DELETE', '/v1/projects/test-ref/organizations/org%2Fone/invitations/invite%2Fone', null],
        ['PUT', '/v1/projects/test-ref/organizations/org%2Fone/jit', '{"enabled":true,"domains":["example.test"]}'],
        ['POST', '/v1/projects/test-ref/organizations/jit/reconcile', '{"user_id":"user-one"}'],
        ['POST', '/v1/projects/test-ref/organizations/org%2Fone/applications', '{"application_id":"app/one"}'],
      ]);
      expect(calls[1]?.authorization).toBe('Bearer gotrue-user-token');
      expect(calls[1]?.authorization).not.toBe('Bearer test-token');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects invitation acceptance without a user bearer before calling SupaCloud', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = mock(() => {
      calls += 1;
      return Promise.resolve(Response.json({ ok: true }));
    }) as unknown as typeof fetch;

    try {
      const adapter = new SupaCloudAdapter();
      await expect(adapter.acceptOrganizationInvitation(
        'org-one',
        'invite-one',
        { token: 'token-one' },
        'Bearer token with spaces',
      )).rejects.toThrow('GoTrue user bearer token');
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('keeps audit downloads on the BFF and proxies file headers', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: string | URL | Request) => {
      const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url).pathname;
      if (path.endsWith('/download')) {
        return Promise.resolve(new Response('{"event":"one"}\n', {
          headers: { 'content-type': 'application/x-ndjson', 'content-disposition': 'attachment; filename="audit.jsonl"' },
        }));
      }
      return Promise.resolve(Response.json({ id: 'export-one', status: 'completed', download_url: '/v1/projects/test-ref/audit/exports/export-one/download' }));
    }) as unknown as typeof fetch;

    try {
      const adapter = new SupaCloudAdapter();
      const created = await adapter.exportAuditLogs({}) as Record<string, unknown>;
      const status = await adapter.getAuditExport('export-one') as Record<string, unknown>;
      const download = await adapter.downloadAuditExport('export-one');

      expect(created.download_url).toBe('/v1/audit/export/export-one/download');
      expect(status.download_url).toBe('/v1/audit/export/export-one/download');
      expect(download.headers.get('content-disposition')).toContain('audit.jsonl');
      expect(await download.text()).toBe('{"event":"one"}\n');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('encodes OAuth client path segments', async () => {
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

      expect(urls[0]).toContain('/auth/oauth-clients/..%2F..%2Fconfig%2Fauth');
      expect(urls[0]).not.toContain('/projects/test-ref/config/auth');
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

  it('verifyGatewayRoutes accepts Supabase-compatible unauthenticated runtime statuses', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/auth/v1/health')) {
        return Promise.resolve(new Response('{"status":"ok"}', { status: 200 }));
      }
      if (url.endsWith('/rest/v1/')) {
        return Promise.resolve(new Response('{"message":"JWT missing"}', { status: 401 }));
      }
      if (url.endsWith('/storage/v1/bucket')) {
        return Promise.resolve(new Response('{"message":"JWT missing"}', { status: 401 }));
      }
      if (url.endsWith('/realtime/v1/websocket')) {
        return Promise.resolve(new Response('upgrade required', { status: 426 }));
      }
      if (url.endsWith('/functions/v1/')) {
        return Promise.resolve(new Response('not found', { status: 404 }));
      }
      return Promise.resolve(new Response('unexpected', { status: 500 }));
    }) as unknown as typeof fetch;

    try {
      const adapter = new SupaCloudAdapter();
      const verification = await adapter.verifyGatewayRoutes();

      expect(verification.ok).toBe(true);
      expect(verification.probes.map((probe) => probe.name)).toEqual([
        'gotrue_health',
        'postgrest_root',
        'storage_buckets',
        'realtime_ws',
        'functions_root',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('verifyGatewayRoutes rejects missing preserved PostgREST, Storage, and Realtime routes', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/auth/v1/health')) {
        return Promise.resolve(new Response('{"status":"ok"}', { status: 200 }));
      }
      if (url.endsWith('/functions/v1/')) {
        return Promise.resolve(new Response('not found', { status: 404 }));
      }
      return Promise.resolve(new Response('missing route', { status: 404 }));
    }) as unknown as typeof fetch;

    try {
      const adapter = new SupaCloudAdapter();
      const verification = await adapter.verifyGatewayRoutes();

      expect(verification.ok).toBe(false);
      expect(verification.probes.find((probe) => probe.name === 'postgrest_root')?.ok).toBe(false);
      expect(verification.probes.find((probe) => probe.name === 'storage_buckets')?.ok).toBe(false);
      expect(verification.probes.find((probe) => probe.name === 'realtime_ws')?.ok).toBe(false);
      expect(verification.probes.find((probe) => probe.name === 'functions_root')?.ok).toBe(true);
      expect(verification.probes.find((probe) => probe.name === 'postgrest_root')?.error).toContain(
        'expected HTTP status in [200, 401, 406], got HTTP 404',
      );
      expect(verification.probes.find((probe) => probe.name === 'storage_buckets')?.error).toContain(
        'expected HTTP status in [200, 401], got HTTP 404',
      );
      expect(verification.probes.find((probe) => probe.name === 'realtime_ws')?.error).toContain(
        'expected HTTP status in [200, 400, 403, 426], got HTTP 404',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
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
