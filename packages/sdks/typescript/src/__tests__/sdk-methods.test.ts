import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { SupaOAuthClient, SupaOAuthAPIError } from '../index.js';

function mockFetch(fn: (input: string | Request, init?: RequestInit) => Promise<Response>) {
  const orig = globalThis.fetch;
  globalThis.fetch = fn as typeof fetch;
  return () => { globalThis.fetch = orig; };
}

describe('SupaOAuthClient — all public methods exist', () => {
  const client = new SupaOAuthClient({ baseUrl: 'http://localhost:4010' });

  const expectedMethods = [
    'health', 'getProject',
    'getRuntimeHealth', 'getOAuthServerStatus', 'getDiscovery', 'getJWKS',
    'listApplications', 'createApplication', 'getApplication', 'updateApplication',
    'deleteApplication', 'rotateApplicationSecret',
    'listApplicationSecrets', 'createApplicationSecret', 'disableApplicationSecret',
    'deleteApplicationSecret', 'getApplicationConsentSettings', 'updateApplicationConsentSettings',
    'getApplicationSignInExperience', 'updateApplicationSignInExperience', 'deleteApplicationSignInExperience',
    'listApplicationBindings', 'createApplicationBinding', 'deleteApplicationBinding',
    'listApplicationScopes',
    'listConnectors', 'getConnector', 'updateConnector', 'testConnector',
    'getConnectorAuthorizationUri', 'listConnectorFactories', 'upsertConnectorFactory',
    'listResources', 'createResource', 'getResource', 'updateResource', 'deleteResource',
    'addScope', 'removeScope',
    'listUsers', 'getUser', 'updateUser', 'suspendUser', 'deleteUser',
    'listUserSessions', 'revokeUserSession', 'unlinkUserIdentity', 'resetUserMfa',
    'getUserPermissions', 'getUserRoles',
    'getMyAccountProfile', 'updateMyAccountProfile', 'listMyAccountSessions',
    'revokeMyAccountSession', 'listMyAccountGrants', 'revokeMyAccountGrant',
    'listOrganizations', 'createOrganization', 'getOrganization', 'updateOrganization',
    'deleteOrganization', 'addOrganizationMember', 'removeOrganizationMember',
    'updateOrganizationMemberRole',
    'listOrganizationInvitations', 'createOrganizationInvitation',
    'updateOrganizationInvitationStatus',
    'getOrganizationJitSettings', 'updateOrganizationJitSettings',
    'listOrganizationApplications', 'upsertOrganizationApplication', 'removeOrganizationApplication',
    'listRoles', 'createRole', 'getRole', 'updateRole', 'deleteRole',
    'listRolePermissions', 'createRolePermission', 'deleteRolePermission',
    'assignRole', 'revokeRole', 'getOrgRoleAssignments',
    'getSignInExperience', 'resolveSignInExperience', 'resolvePublicSignInExperience', 'updateSignInExperience',
    'getAuthConfig', 'updateAuthConfig',
    'getCompatibilityReport',
    'listTenantConfigs', 'getTenantConfig', 'upsertTenantConfig', 'deleteTenantConfig',
    'checkTenantDomain',
    'getAuthHookRegistrationGuide',
    'listWebhooks', 'createWebhook', 'getWebhook', 'updateWebhook',
    'deleteWebhook', 'rotateWebhookSecret',
    'listWebhookLogs', 'testWebhook', 'replayWebhook', 'listWebhookEvents',
    'syncUserMetadata', 'syncOrgMetadata',
    'listAuditLogs',
    'compileAuthorizationPlan', 'getAuthorizationCompilerDemo',
    'generateRLSMigration', 'getRLSMigrationDemo',
    'listUserConsents', 'grantConsent', 'revokeConsent', 'listApplicationConsents',
    'listOrgTemplates', 'createOrgTemplate', 'instantiateOrgTemplate',
    'getSecurityStatus', 'getProvisioningStatus', 'reconcileProject',
    'listEnterpriseSSOConfigs', 'createEnterpriseSSOConfig', 'listUserPasskeys',
    'setAccessToken',
  ];

  it('has all expected public methods', () => {
    for (const method of expectedMethods) {
      expect(typeof (client as any)[method]).toBe('function');
    }
  });

  it('setAccessToken is a function', () => {
    expect(typeof (client as any).setAccessToken).toBe('function');
  });
});

describe('SupaOAuthClient — request serialization', () => {
  let client: SupaOAuthClient;

  beforeEach(() => {
    client = new SupaOAuthClient({ baseUrl: 'http://localhost:4010', accessToken: 'tk' });
  });

  it('sends JSON body in POST requests', async () => {
    let capturedBody: string | undefined;
    const restore = mockFetch((_input, init) => {
      capturedBody = init?.body as string | undefined;
      return Promise.resolve(new Response(JSON.stringify({ id: 'new' }), { status: 201 }));
    });

    try {
      await (client as any)['request']('/v1/resources', {
        method: 'POST',
        body: JSON.stringify({ name: 'test-resource' }),
      });
      expect(capturedBody).toEqual('{"name":"test-resource"}');
    } finally {
      restore();
    }
  });

  it('includes Content-Type application/json', async () => {
    let capturedHeaders: Record<string, string> = {};
    const restore = mockFetch((_input, init) => {
      capturedHeaders = (init?.headers || {}) as Record<string, string>;
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });

    try {
      await (client as any)['request']('/v1/health');
      expect(capturedHeaders['Content-Type']).toBe('application/json');
    } finally {
      restore();
    }
  });

  it('constructs correct URL with base', async () => {
    let capturedUrl: string = '';
    const restore = mockFetch((input) => {
      capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });

    try {
      await (client as any)['request']('/v1/health');
      expect(capturedUrl).toBe('http://localhost:4010/v1/health');
    } finally {
      restore();
    }
  });
});

describe('SupaOAuthClient — query string construction', () => {
  let client: SupaOAuthClient;

  beforeEach(() => {
    client = new SupaOAuthClient({ baseUrl: 'http://localhost:4010', accessToken: 'tk' });
  });

  it('listAuditLogs builds query string from params', async () => {
    let capturedUrl: string = '';
    const restore = mockFetch((input) => {
      capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return Promise.resolve(new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
    });

    try {
      await client.listAuditLogs({ event_type: 'user.created', limit: 10, offset: 5 });
      expect(capturedUrl).toContain('event_type=user.created');
      expect(capturedUrl).toContain('limit=10');
      expect(capturedUrl).toContain('offset=5');
    } finally {
      restore();
    }
  });

  it('listAuditLogs returns empty query when no params', async () => {
    let capturedUrl: string = '';
    const restore = mockFetch((input) => {
      capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return Promise.resolve(new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
    });

    try {
      await client.listAuditLogs();
      expect(capturedUrl).toBe('http://localhost:4010/v1/audit');
    } finally {
      restore();
    }
  });

  it('listTenantConfigs passes type query param', async () => {
    let capturedUrl: string = '';
    const restore = mockFetch((input) => {
      capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return Promise.resolve(new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
    });

    try {
      await client.listTenantConfigs('domain');
      expect(capturedUrl).toContain('type=domain');
    } finally {
      restore();
    }
  });

  it('listConnectorFactories passes category query param', async () => {
    let capturedUrl: string = '';
    const restore = mockFetch((input) => {
      capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return Promise.resolve(new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
    });

    try {
      await client.listConnectorFactories('social');
      expect(capturedUrl).toContain('category=social');
    } finally {
      restore();
    }
  });

  it('listConnectorFactories omits query when no category', async () => {
    let capturedUrl: string = '';
    const restore = mockFetch((input) => {
      capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return Promise.resolve(new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
    });

    try {
      await client.listConnectorFactories();
      expect(capturedUrl).toBe('http://localhost:4010/v1/connectors/factories');
    } finally {
      restore();
    }
  });

  it('getConnectorAuthorizationUri builds query from params', async () => {
    let capturedUrl: string = '';
    const restore = mockFetch((input) => {
      capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });

    try {
      await client.getConnectorAuthorizationUri('conn-1', {
        redirect_uri: 'http://localhost/callback',
        state: 'random-state',
        scope: 'openid profile',
      });
      expect(capturedUrl).toContain('redirect_uri=http');
      expect(capturedUrl).toContain('state=random-state');
      expect(capturedUrl).toContain('scope=openid+profile');
    } finally {
      restore();
    }
  });

  it('getUserPermissions passes org_id query param', async () => {
    let capturedUrl: string = '';
    const restore = mockFetch((input) => {
      capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return Promise.resolve(new Response(JSON.stringify({ roles: [], permissions: [], scopes: [] }), { status: 200 }));
    });

    try {
      await client.getUserPermissions('user-1', 'org-1');
      expect(capturedUrl).toContain('org_id=org-1');
    } finally {
      restore();
    }
  });

  it('syncUserMetadata passes org_id query param', async () => {
    let capturedUrl: string = '';
    const restore = mockFetch((input) => {
      capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return Promise.resolve(new Response(JSON.stringify({ synced: true }), { status: 200 }));
    });

    try {
      await client.syncUserMetadata('user-1', 'org-1');
      expect(capturedUrl).toContain('org_id=org-1');
    } finally {
      restore();
    }
  });
});

describe('SupaOAuthClient — error handling edge cases', () => {
  let client: SupaOAuthClient;

  beforeEach(() => {
    client = new SupaOAuthClient({ baseUrl: 'http://localhost:4010' });
  });

  it('handles 500 server error', async () => {
    const restore = mockFetch(() =>
      Promise.resolve(new Response('Internal Server Error', { status: 500 }))
    );
    try {
      await expect(client.health()).rejects.toThrow();
      await expect(client.health()).rejects.toBeInstanceOf(SupaOAuthAPIError);
    } finally {
      restore();
    }
  });

  it('handles 403 forbidden', async () => {
    const restore = mockFetch(() =>
      Promise.resolve(new Response('Forbidden', { status: 403 }))
    );
    try {
      const err = await client.listRoles().catch(e => e);
      expect(err).toBeInstanceOf(SupaOAuthAPIError);
      expect(err.status).toBe(403);
    } finally {
      restore();
    }
  });

  it('handles 204 no content', async () => {
    const restore = mockFetch(() =>
      Promise.resolve(new Response(null, { status: 204 }))
    );
    try {
      const result = await client.deleteRole('role-1');
      expect(result).toBeNull();
    } finally {
      restore();
    }
  });
});

describe('SupaOAuthClient — constructor edge cases', () => {
  it('trims trailing slashes from baseUrl', () => {
    const c = new SupaOAuthClient({ baseUrl: 'http://localhost:4010////' });
    expect((c as any).baseUrl).toBe('http://localhost:4010');
  });

  it('handles baseUrl with no trailing slashes', () => {
    const c = new SupaOAuthClient({ baseUrl: 'http://localhost:4010' });
    expect((c as any).baseUrl).toBe('http://localhost:4010');
  });

  it('stores undefined accessToken as null', () => {
    const c = new SupaOAuthClient({ baseUrl: 'http://localhost:4010' });
    expect((c as any).accessToken).toBeNull();
  });

  it('stores provided accessToken', () => {
    const c = new SupaOAuthClient({ baseUrl: 'http://localhost:4010', accessToken: 'my-token' });
    expect((c as any).accessToken).toBe('my-token');
  });
});
