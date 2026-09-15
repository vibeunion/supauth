import { describe, it, expect, beforeEach } from 'bun:test';
import { SupaOAuthClient, SupaOAuthAPIError, SupaOAuthRequestContractError, type SupaOAuthFetch, type SupaOAuthClientOptions } from '../index.js';
import { health, resource, responseForRequest, responses } from './domain-fixtures.js';

let transport: SupaOAuthFetch = async () => { throw new Error('Configure the test transport'); };
function mockFetch(fn: SupaOAuthFetch) {
  const orig = transport;
  transport = fn;
  return () => { transport = orig; };
}

function createClient(options: SupaOAuthClientOptions) {
  return new SupaOAuthClient({ ...options, fetch: (input, init) => transport(input, init) });
}

async function capturedRequestUrl(invoke: (client: SupaOAuthClient) => Promise<unknown>, response?: unknown) {
  let requestUrl = '';
  const restore = mockFetch((input, init) => {
    requestUrl = input instanceof Request ? input.url : String(input);
    const fixture = response ?? responseForRequest(requestUrl, init?.method);
    return Promise.resolve(fixture === undefined ? new Response(null, { status: 204 }) : Response.json(fixture));
  });
  try {
    await invoke(createClient({ baseUrl: 'http://localhost:4010', accessToken: 'tk' }));
    return requestUrl;
  } finally {
    restore();
  }
}

describe('SupaOAuthClient — all public methods exist', () => {
  const client = createClient({ baseUrl: 'http://localhost:4010' });

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
  ] as const satisfies readonly (keyof SupaOAuthClient)[];

  it('has all expected public methods', () => {
    for (const method of expectedMethods) {
      expect(typeof client[method]).toBe('function');
    }
  });

  it('setAccessToken is a function', () => {
    expect(typeof client.setAccessToken).toBe('function');
  });
});

describe('SupaOAuthClient — request serialization', () => {
  let client: SupaOAuthClient;

  beforeEach(() => {
    client = createClient({ baseUrl: 'http://localhost:4010', accessToken: 'tk' });
  });

  it('sends JSON body in POST requests', async () => {
    let capturedBody: string | undefined;
    const restore = mockFetch((_input, init) => {
      const body = init?.body;
      if (body !== undefined && typeof body !== 'string') throw new Error('Expected JSON request text');
      capturedBody = body;
      return Promise.resolve(Response.json(resource, { status: 201 }));
    });

    try {
      await client.createResource({ name: 'test-resource', indicator: 'https://api.example.test' });
      expect(capturedBody).toEqual('{"name":"test-resource","indicator":"https://api.example.test"}');
    } finally {
      restore();
    }
  });

  it('includes Content-Type application/json', async () => {
    let capturedHeaders = new Headers();
    const restore = mockFetch((_input, init) => {
      capturedHeaders = new Headers(init?.headers);
      return Promise.resolve(Response.json(health));
    });

    try {
      await client.health();
      expect(capturedHeaders.get('Content-Type')).toBe('application/json');
    } finally {
      restore();
    }
  });

  it('constructs correct URL with base', async () => {
    let capturedUrl: string = '';
    const restore = mockFetch((input) => {
      capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return Promise.resolve(Response.json(health));
    });

    try {
      await client.health();
      expect(capturedUrl).toBe('http://localhost:4010/v1/health');
    } finally {
      restore();
    }
  });
});

describe('SupaOAuthClient — query string construction', () => {
  let client: SupaOAuthClient;

  beforeEach(() => {
    client = createClient({ baseUrl: 'http://localhost:4010', accessToken: 'tk' });
  });

  it('listAuditLogs builds query string from params', async () => {
    let capturedUrl: string = '';
    const restore = mockFetch((input) => {
      capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return Promise.resolve(Response.json(responses.listAuditLogs));
    });

    try {
      await client.listAuditLogs({ event_type: 'user.created', status: 201, method: 'POST', limit: 10, offset: 5 });
      expect(capturedUrl).toContain('event_type=user.created');
      expect(capturedUrl).toContain('status=201');
      expect(capturedUrl).toContain('method=POST');
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
      return Promise.resolve(Response.json(responses.listAuditLogs));
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
      return Promise.resolve(Response.json(responses.getConnectorAuthorizationUri));
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
      const client = createClient({ baseUrl: 'http://localhost:4010' });
      expect(() => client.getUser(invalidSegment)).toThrow(SupaOAuthRequestContractError);
    });
  }

  it('keeps org_id query input in one parameter', async () => {
    const orgId = 'org-one&application_id=victim#fragment';
    const requestUrl = await capturedRequestUrl(
      (client) => client.getUserPermissions('user-one', orgId),
      { roles: [], permissions: [], scopes: [] },
    );
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
    client = createClient({ baseUrl: 'http://localhost:4010' });
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
      const request = client.listRoles();
      await expect(request).rejects.toBeInstanceOf(SupaOAuthAPIError);
      await expect(request).rejects.toMatchObject({ status: 403 });
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
      expect(result).toBeUndefined();
    } finally {
      restore();
    }
  });
});

describe('SupaOAuthClient — constructor edge cases', () => {
  it.each(['http://localhost:4010////', 'http://localhost:4010'])('normalizes request URL from %s', async baseUrl => {
    const c = new SupaOAuthClient({ baseUrl, fetch: async input => {
      expect(String(input)).toBe('http://localhost:4010/v1/health');
      return Response.json(health);
    } });
    await c.health();
  });

  it.each([undefined, 'my-token'])('sends only a configured token %s', async accessToken => {
    const c = new SupaOAuthClient({
      baseUrl: 'http://localhost:4010',
      ...(accessToken === undefined ? {} : { accessToken }),
      fetch: async (_input, init) => {
        expect(new Headers(init?.headers).get('authorization')).toBe(accessToken === undefined ? null : `Bearer ${accessToken}`);
        return Response.json(health);
      },
    });
    await c.health();
  });
});
