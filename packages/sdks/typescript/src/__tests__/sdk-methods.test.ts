import { describe, it, expect, beforeEach } from 'bun:test';
import { SupaOAuthClient, SupaOAuthAPIError } from '../index.js';

function mockFetch(fn: (input: string | Request, init?: RequestInit) => Promise<Response>) {
  const orig = globalThis.fetch;
  globalThis.fetch = fn as typeof fetch;
  return () => { globalThis.fetch = orig; };
}

async function capturedRequestUrl(invoke: (client: SupaOAuthClient) => Promise<unknown>) {
  let requestUrl = '';
  const restore = mockFetch((input) => {
    requestUrl = typeof input === 'string' ? input : input.url;
    return Promise.resolve(Response.json({}));
  });
  try {
    await invoke(new SupaOAuthClient({ baseUrl: 'http://localhost:4010', accessToken: 'tk' }));
    return requestUrl;
  } finally {
    restore();
  }
}

describe('SupaOAuthClient — all public methods exist', () => {
  const client = new SupaOAuthClient({ baseUrl: 'http://localhost:4010' });

  const expectedMethods = [
    'health', 'getProject',
    'getRuntimeHealth', 'getOAuthServerStatus', 'getDiscovery', 'getJWKS',
    'listApplications', 'createApplication', 'getApplication', 'updateApplication',
    'deleteApplication', 'rotateApplicationSecret',
    'getApplicationConsentSettings', 'updateApplicationConsentSettings',
    'getApplicationSignInExperience', 'updateApplicationSignInExperience', 'deleteApplicationSignInExperience',
    'listApplicationBindings', 'createApplicationBinding', 'deleteApplicationBinding',
    'listApplicationScopes',
    'listConnectors', 'getConnector', 'updateConnector', 'testConnector',
    'getConnectorAuthorizationUri', 'listConnectorFactories', 'upsertConnectorFactory',
    'listResources', 'createResource', 'getResource', 'updateResource', 'deleteResource',
    'addScope', 'removeScope',
    'listUsers', 'getUser', 'updateUser', 'suspendUser', 'deleteUser',
    'resetUserMfa',
    'getUserPermissions', 'getUserRoles',
    'listOrganizations', 'createOrganization', 'getOrganization', 'updateOrganization',
    'deleteOrganization', 'addOrganizationMember', 'removeOrganizationMember',
    'updateOrganizationMemberRole',
    'listOrganizationInvitations', 'createOrganizationInvitation',
    'acceptOrganizationInvitation', 'revokeOrganizationInvitation',
    'getOrganizationJitSettings', 'updateOrganizationJitSettings',
    'listOrganizationApplications', 'bindOrganizationApplication', 'removeOrganizationApplication',
    'listRoles', 'createRole', 'getRole', 'updateRole', 'deleteRole',
    'listRolePermissions', 'createRolePermission', 'deleteRolePermission',
    'assignRole', 'listRoleAssignments', 'revokeRole', 'getOrgRoleAssignments',
    'getSignInExperience', 'resolveSignInExperience', 'resolvePublicSignInExperience', 'getPublicPhrases', 'updateSignInExperience',
    'getAuthConfig', 'updateAuthConfig',
    'getCompatibilityReport',
    'listTenantConfigs', 'getTenantConfig', 'upsertTenantConfig', 'deleteTenantConfig',
    'checkTenantDomain',
    'getAuthHookRegistrationGuide',
    'listWebhooks', 'createWebhook', 'getWebhook', 'updateWebhook',
    'deleteWebhook', 'rotateWebhookSecret',
    'listWebhookLogs', 'testWebhook', 'listWebhookEvents',
    'syncUserMetadata', 'syncOrgMetadata',
    'listAuditLogs',
    'compileAuthorizationPlan', 'getAuthorizationCompilerDemo',
    'generateRLSMigration', 'getRLSMigrationDemo',
    'getCapabilities', 'createUser', 'listUserLogs', 'listUserOrganizations',
    'listApplicationRoles', 'listApplicationLogs', 'listApplicationOrganizations', 'getApplicationAccessControl', 'updateApplicationAccessControl',
    'listOrganizationMembers', 'getOrganizationBranding', 'updateOrganizationBranding',
    'updateScope', 'listResourceApplications',
    'listWebhookDeliveries', 'getWebhookDelivery', 'replayWebhookDelivery',
    'getAuditLog', 'createAuditExport', 'getAuditExport', 'getAuditExportDownload', 'getAuditIntegrity',
    'listTenantMembers', 'updateTenantMember', 'removeTenantMember', 'listTenantInvitations', 'createTenantInvitation',
    'getAuthHookStatus', 'verifyAuthHook', 'getBeforeUserCreatedHookStatus', 'verifyBeforeUserCreatedHook',
    'listOrgTemplates', 'createOrgTemplate', 'instantiateOrgTemplate',
    'getSecurityStatus', 'getProvisioningStatus', 'reconcileProject',
    'listEnterpriseSSOConfigs', 'createEnterpriseSSOConfig',
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

  it('getPublicPhrases encodes the language tag in the path', async () => {
    let capturedUrl: string = '';
    const restore = mockFetch((input) => {
      capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return Promise.resolve(new Response(JSON.stringify({ language_tag: 'zh-CN', phrases: {} }), { status: 200 }));
    });

    try {
      await client.getPublicPhrases('zh-CN');
      expect(capturedUrl).toBe('http://localhost:4010/v1/public/phrases/zh-CN');
    } finally {
      restore();
    }
  });
});

describe('SupaOAuthClient — dynamic URL boundaries', () => {
  const encodedPathCases = [
    {
      name: 'application traversal input',
      invoke: (client: SupaOAuthClient) => client.getApplication('../users/victim'),
      expectedPath: '/v1/applications/..%2Fusers%2Fvictim',
    },
    {
      name: 'connector slash',
      invoke: (client: SupaOAuthClient) => client.getConnector('connector/child'),
      expectedPath: '/v1/connectors/connector%2Fchild',
    },
    {
      name: 'resource question mark',
      invoke: (client: SupaOAuthClient) => client.getResource('resource?admin=true'),
      expectedPath: '/v1/resources/resource%3Fadmin%3Dtrue',
    },
    {
      name: 'nested scope segments',
      invoke: (client: SupaOAuthClient) => client.updateScope('resource/one', 'scope#one', { name: 'scope' }),
      expectedPath: '/v1/resources/resource%2Fone/scopes/scope%23one',
    },
    {
      name: 'user traversal input',
      invoke: (client: SupaOAuthClient) => client.deleteUser('../applications/victim-app'),
      expectedPath: '/v1/users/..%2Fapplications%2Fvictim-app',
    },
    {
      name: 'organization hash',
      invoke: (client: SupaOAuthClient) => client.getOrganization('organization#fragment'),
      expectedPath: '/v1/organizations/organization%23fragment',
    },
    {
      name: 'role whitespace and Unicode',
      invoke: (client: SupaOAuthClient) => client.getRole('角色 一'),
      expectedPath: '/v1/roles/%E8%A7%92%E8%89%B2%20%E4%B8%80',
    },
    {
      name: 'webhook traversal input',
      invoke: (client: SupaOAuthClient) => client.getWebhook('../applications/victim-app'),
      expectedPath: '/v1/webhooks/..%2Fapplications%2Fvictim-app',
    },
    {
      name: 'tenant member slash',
      invoke: (client: SupaOAuthClient) => client.updateTenantMember('member/one', { role: 'owner' }),
      expectedPath: '/v1/tenant/members/member%2Fone',
    },
    {
      name: 'audit export fragment',
      invoke: (client: SupaOAuthClient) => client.getAuditExport('export#one'),
      expectedPath: '/v1/audit/export/export%23one',
    },
    {
      name: 'provisioning slash',
      invoke: (client: SupaOAuthClient) => client.getProvisioningStatus('project/other'),
      expectedPath: '/v1/provisioning/project%2Fother',
    },
  ] as const;

  for (const pathCase of encodedPathCases) {
    it(`encodes ${pathCase.name} as one path segment`, async () => {
      const requestUrl = await capturedRequestUrl(pathCase.invoke);
      expect(new URL(requestUrl).pathname).toBe(pathCase.expectedPath);
    });
  }

  for (const invalidSegment of ['', '.', '..']) {
    it(`rejects invalid path segment ${JSON.stringify(invalidSegment)}`, () => {
      const client = new SupaOAuthClient({ baseUrl: 'http://localhost:4010' });
      expect(() => client.getUser(invalidSegment)).toThrow(TypeError);
    });
  }

  it('keeps org_id query input in one parameter', async () => {
    const orgId = 'org-one&application_id=victim#fragment';
    const requestUrl = await capturedRequestUrl((client) => client.getUserPermissions('user-one', orgId));
    const url = new URL(requestUrl);
    expect(url.searchParams.get('org_id')).toBe(orgId);
    expect(url.searchParams.has('application_id')).toBe(false);
  });

  it('keeps sync org_id query input in one parameter', async () => {
    const orgId = 'org-one&force=true#fragment';
    const requestUrl = await capturedRequestUrl((client) => client.syncUserMetadata('user-one', orgId));
    const url = new URL(requestUrl);
    expect(url.searchParams.get('org_id')).toBe(orgId);
    expect(url.searchParams.has('force')).toBe(false);
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
