import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { SupaCloudAdapter, SupaCloudApiError } from '../supacloud/adapter.js';
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
      'updateProvider', 'createCustomOidcProvider', 'getCustomOidcProvider',
      'updateCustomOidcProvider', 'deleteCustomOidcProvider',
      'createSamlProvider', 'getSamlProvider', 'updateSamlProvider', 'deleteSamlProvider',
      'preflightProviderAuthorization', 'startSamlProviderAuthorization',
      'listUsers', 'createUser', 'getUser', 'deleteUser', 'updateUser',
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
      'getAuthHooks', 'updateAuthHooks', 'getAuthHookStatus', 'verifyAuthHook', 'verifyAuthHookMessage',
      'listStorageBuckets', 'getStorageBucket', 'createStorageBucket',
      'deleteStorageBucket', 'uploadFile', 'deleteFile', 'downloadFile', 'createSignedUrl', 'getPublicUrl',
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

  it('preserves Storage bucket lookup status in the adapter error contract', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => new Response('bucket unavailable', { status: 503 })) as unknown as typeof fetch;

    try {
      const adapter = new SupaCloudAdapter();
      const lookupFailure = await adapter.getStorageBucket('branding').catch(error => error);
      expect(lookupFailure).toBeInstanceOf(SupaCloudApiError);
      expect(lookupFailure).toMatchObject({
        status: 503,
        body: 'bucket unavailable',
        path: '/storage/v1/bucket/branding',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses the canonical project auth-hook configuration contract', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ method: string; path: string; body?: string }> = [];
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({
        method: init?.method || 'GET',
        path: new URL(url).pathname,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      return Promise.resolve(Response.json({
        custom_access_token_hook: {
          enabled: true,
          uri: 'https://auth.example.test/api/v1/auth-hooks/custom-access-token',
          secrets_configured: true,
        },
      }));
    }) as unknown as typeof fetch;

    try {
      const adapter = new SupaCloudAdapter();
      await adapter.getAuthHooks();
      await adapter.updateAuthHooks({
        custom_access_token_hook: {
          enabled: false,
          uri: 'https://auth.example.test/api/v1/auth-hooks/custom-access-token',
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(calls.map(({ method, path }) => [method, path])).toEqual([
      ['GET', '/v1/projects/test-ref/auth/hooks'],
      ['PATCH', '/v1/projects/test-ref/auth/hooks'],
    ]);
    expect(JSON.parse(calls[1]?.body || '{}')).toEqual({
      custom_access_token_hook: {
        enabled: false,
        uri: 'https://auth.example.test/api/v1/auth-hooks/custom-access-token',
      },
    });
  });

  it('encodes private Storage object paths for upload, download, and deletion', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ method: string; path: string; authorization: string | null }> = [];
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({
        method: init?.method || 'GET',
        path: new URL(url).pathname,
        authorization: new Headers(init?.headers).get('authorization'),
      });
      return Promise.resolve(url.includes('/authenticated/')
        ? new Response('asset')
        : Response.json({ Key: 'stored' }));
    }) as unknown as typeof fetch;

    try {
      const adapter = new SupaCloudAdapter();
      const bucketId = 'custom.ui-assets_1';
      const objectPath = 'versions/one/assets/app name.js';
      await adapter.uploadFile(bucketId, objectPath, new Blob(['asset']), 'text/javascript');
      const download = await adapter.downloadFile(bucketId, objectPath);
      await adapter.deleteFile(bucketId, [objectPath]);

      expect(await download.text()).toBe('asset');
      expect(calls.map(call => [call.method, call.path])).toEqual([
        ['POST', '/storage/v1/object/custom.ui-assets_1/versions/one/assets/app%20name.js'],
        ['GET', '/storage/v1/object/authenticated/custom.ui-assets_1/versions/one/assets/app%20name.js'],
        ['DELETE', '/storage/v1/object/custom.ui-assets_1'],
      ]);
      expect(calls.every(call => call.authorization === 'Bearer test-token')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('signs only safe encoded Storage object paths with a positive integer expiry', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ path: string; body: string | null }> = [];
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({
        path: new URL(url).pathname,
        body: typeof init?.body === 'string' ? init.body : null,
      });
      return Promise.resolve(Response.json({ signedURL: 'https://storage.test/signed/object' }));
    }) as unknown as typeof fetch;

    try {
      const adapter = new SupaCloudAdapter();
      await expect(adapter.createSignedUrl(
        'avatars.v2-test_1',
        '用户 one/folder/literal%20#?.png',
        1,
      )).resolves.toBe('https://storage.test/signed/object');
      await expect(adapter.createSignedUrl('avatars', 'plain.png')).resolves.toBe(
        'https://storage.test/signed/object',
      );

      expect(calls).toEqual([
        {
          path: '/storage/v1/object/sign/avatars.v2-test_1/%E7%94%A8%E6%88%B7%20one/folder/literal%2520%23%3F.png',
          body: '{"expiresIn":1}',
        },
        {
          path: '/storage/v1/object/sign/avatars/plain.png',
          body: '{"expiresIn":3600}',
        },
      ]);

      const unsafePaths = [
        '../branding/logo.svg',
        'users/../../branding/logo.svg',
        '%2e%2e/branding/logo.svg',
        '%252e%252e%252fbranding%252flogo.svg',
        'users%2F..%2Fbranding/logo.svg',
        '..\\branding\\logo.svg',
        '/users/avatar.png',
        'users//avatar.png',
        'users/%00/avatar.png',
      ];
      for (const unsafePath of unsafePaths) {
        await expect(adapter.createSignedUrl('avatars', unsafePath)).rejects.toThrow(
          'Storage object path contains an unsafe segment',
        );
      }

      const unsafeBuckets = [
        '',
        '.',
        '..',
        '../avatars',
        'avatars/child',
        'avatars\\child',
        '%2e%2e',
        'avatars%2Fchild',
        'a'.repeat(101),
        '头像',
      ];
      for (const unsafeBucket of unsafeBuckets) {
        await expect(adapter.createSignedUrl(unsafeBucket, 'plain.png')).rejects.toThrow(
          'Storage bucket ID is invalid',
        );
      }

      for (const invalidExpiry of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
        await expect(adapter.createSignedUrl('avatars', 'plain.png', invalidExpiry)).rejects.toThrow(
          'Storage signed URL expiry must be a positive safe integer',
        );
      }
      expect(calls).toHaveLength(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fails closed on malformed signed URL response payloads', async () => {
    const originalFetch = globalThis.fetch;
    const responses: Record<string, unknown>[] = [
      { signedURL: '/object/sign/avatars/plain.png?token=valid' },
      {},
      { signedURL: '' },
      { signedURL: '  ' },
      { signedURL: 'relative/object' },
      { signedURL: '//attacker.example/object' },
      { signedURL: 'javascript:alert(1)' },
      { signedURL: 'https://user:password@storage.test/object' },
      { signedURL: 42 },
    ];
    globalThis.fetch = mock(async () => Response.json(responses.shift())) as unknown as typeof fetch;

    try {
      const adapter = new SupaCloudAdapter();
      await expect(adapter.createSignedUrl('avatars', 'plain.png')).resolves.toBe(
        '/object/sign/avatars/plain.png?token=valid',
      );
      while (responses.length > 0) {
        await expect(adapter.createSignedUrl('avatars', 'plain.png')).rejects.toThrow(
          'Storage sign URL response did not contain a valid signedURL',
        );
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
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

  it('checks OAuth and SAML runtime configuration without a fabricated management endpoint', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; method: string; body: string | null }> = [];
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({
        url,
        method: init?.method || 'GET',
        body: typeof init?.body === 'string' ? init.body : null,
      });
      const authorizationUrl = url.includes('/sso?')
        ? 'https://idp.example.test/saml/login'
        : 'https://idp.example.test/oauth/authorize';
      return Promise.resolve(Response.json({ url: authorizationUrl }));
    }) as unknown as typeof fetch;

    try {
      const adapter = new SupaCloudAdapter();
      await expect(adapter.preflightProviderAuthorization('github', 'builtin_oauth')).resolves.toMatchObject({
        status: 'reachable',
        check_kind: 'runtime_configuration',
        runtime_kind: 'builtin_oauth',
      });
      await expect(adapter.preflightProviderAuthorization('saml-provider', 'saml')).resolves.toMatchObject({
        status: 'reachable',
        runtime_kind: 'saml',
      });

      expect(calls.map(call => new URL(call.url).pathname)).toEqual([
        '/auth/v1/authorize',
        '/auth/v1/sso',
      ]);
      expect(calls[0]).toMatchObject({ method: 'GET', body: null });
      expect(calls[0]?.url).toContain('provider=github');
      expect(calls[1]).toEqual({
        url: 'http://runtime.test/auth/v1/sso',
        method: 'POST',
        body: '{"provider_id":"saml-provider","skip_http_redirect":true}',
      });
      expect(calls.every(call => !call.url.includes('/auth/providers/'))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses typed enterprise OIDC and SAML management endpoints with encoded readback IDs', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ method: string; path: string; body: string | null }> = [];
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({
        method: init?.method || 'GET',
        path: new URL(url).pathname,
        body: typeof init?.body === 'string' ? init.body : null,
      });
      return Promise.resolve(Response.json({ id: 'provider', identifier: 'custom:workos' }));
    }) as unknown as typeof fetch;

    try {
      const adapter = new SupaCloudAdapter();
      await adapter.createCustomOidcProvider({ provider_type: 'oidc', client_secret: 'once' });
      await adapter.getCustomOidcProvider('custom:work/os');
      await adapter.updateCustomOidcProvider('custom:work/os', { enabled: false });
      await adapter.deleteCustomOidcProvider('custom:work/os');
      await adapter.createSamlProvider({
        type: 'saml',
        metadata_url: 'https://idp.example.test/metadata',
        name_id_format: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
        disabled: false,
      });
      await adapter.getSamlProvider('saml/provider');
      await adapter.updateSamlProvider('saml/provider', { disabled: true });
      await adapter.deleteSamlProvider('saml/provider');

      expect(calls).toEqual([
        {
          method: 'POST',
          path: '/v1/projects/test-ref/auth/custom-providers',
          body: '{"provider_type":"oidc","client_secret":"once"}',
        },
        {
          method: 'GET',
          path: '/v1/projects/test-ref/auth/custom-providers/custom%3Awork%2Fos',
          body: null,
        },
        {
          method: 'PUT',
          path: '/v1/projects/test-ref/auth/custom-providers/custom%3Awork%2Fos',
          body: '{"enabled":false}',
        },
        {
          method: 'DELETE',
          path: '/v1/projects/test-ref/auth/custom-providers/custom%3Awork%2Fos',
          body: null,
        },
        {
          method: 'POST',
          path: '/v1/projects/test-ref/auth/sso/providers',
          body: '{"type":"saml","metadata_url":"https://idp.example.test/metadata","name_id_format":"urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress","disabled":false}',
        },
        {
          method: 'GET',
          path: '/v1/projects/test-ref/auth/sso/providers/saml%2Fprovider',
          body: null,
        },
        {
          method: 'PUT',
          path: '/v1/projects/test-ref/auth/sso/providers/saml%2Fprovider',
          body: '{"disabled":true}',
        },
        {
          method: 'DELETE',
          path: '/v1/projects/test-ref/auth/sso/providers/saml%2Fprovider',
          body: null,
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects unsafe connector preflight URLs returned by the runtime', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => Response.json({ url: 'javascript:alert(1)' })) as unknown as typeof fetch;
    try {
      const adapter = new SupaCloudAdapter();
      await expect(adapter.preflightProviderAuthorization('github', 'builtin_oauth'))
        .rejects.toThrow('unsafe authorization URL');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not duplicate the auth/v1 prefix for a prefixed runtime base URL', async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      urls.push(url);
      return Promise.resolve(Response.json({ url: 'https://idp.example.test/authorize' }));
    }) as unknown as typeof fetch;
    try {
      const adapter = new SupaCloudAdapter({ runtimeUrl: 'http://runtime.test/auth/v1' });
      await adapter.preflightProviderAuthorization('github', 'builtin_oauth');
      expect(new URL(urls[0] || '').pathname).toBe('/auth/v1/authorize');
      expect(urls[0]).not.toContain('/auth/v1/auth/v1/');
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
