import { describe, expect, it, mock } from 'bun:test';
import { decodeSchema, sdkEndpoints, Type, type SdkEndpointName } from '@supauth/shared';
import { SupaOAuthClient, SupaOAuthAPIError, SupaOAuthRequestContractError, SupaOAuthResponseContractError } from '../index.js';
import { invocations } from './domain-invocations.js';
import { bodies, responses, role } from './domain-fixtures.js';

const names = Object.keys(invocations).filter((name): name is SdkEndpointName => Object.hasOwn(sdkEndpoints, name));

describe('complete SDK operation contracts', () => {
  it('accounts for every public domain method and every endpoint fixture', () => {
    const publicNames = Object.getOwnPropertyNames(SupaOAuthClient.prototype).filter(name =>
      !['constructor', 'setAccessToken', 'requestHeaders', 'response', 'jsonResponse', 'requestDecoded', 'execute',
        'endpointRequest', 'endpointJson', 'endpointVoid', 'endpointBlob'].includes(name));
    expect(publicNames.sort()).toEqual([...names].sort());
    expect<string[]>(names.sort()).toEqual(Object.keys(sdkEndpoints).sort());
    expect<string[]>(names.sort()).toEqual(Object.keys(responses).sort());
    expect(names).toHaveLength(141);
  });

  for (const name of names) {
    const contract = sdkEndpoints[name];
    it(`${name}: accepts a complete protocol fixture and sends the declared operation exactly once`, async () => {
      const fetcher = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const request = new Request(url, init);
        const path = new URL(request.url).pathname;
        expect(request.method).toBe(contract.method);
        expect(path).toMatch(new RegExp(`^${contract.path.replace(/:[A-Za-z]+/g, '[^/]+')}$`));
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer current-token');
        if (contract.responseKind === 'void') return new Response(null, { status: 204 });
        if (contract.responseKind === 'blob') return new Response('export-content', { headers: { 'Content-Type': 'application/x-ndjson' } });
        return Response.json(responses[name]);
      });
      const client = new SupaOAuthClient({ baseUrl: 'https://auth.example.test///', accessToken: 'current-token', fetch: fetcher });
      const result: unknown = await invocations[name](client);
      if (contract.responseKind === 'blob') {
        expect(result).toBeInstanceOf(Blob);
        if (result instanceof Blob) expect(await result.text()).toBe('export-content');
      } else {
        expect(result).toEqual(responses[name]);
      }
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    if (contract.responseKind === 'json') {
      it(`${name}: rejects malformed root payloads and unexpected empty responses`, async () => {
        for (const invalid of [null, [], 'invalid-response']) {
          const fetcher = mock(async () => Response.json(invalid));
          const client = new SupaOAuthClient({ baseUrl: 'https://auth.example.test', fetch: fetcher });
          await expect(invocations[name](client)).rejects.toBeInstanceOf(SupaOAuthResponseContractError);
          expect(fetcher).toHaveBeenCalledTimes(1);
        }
        for (const status of [204, 205]) {
          const client = new SupaOAuthClient({ baseUrl: 'https://auth.example.test', fetch: async () => new Response(null, { status }) });
          await expect(invocations[name](client)).rejects.toMatchObject({ reason: 'unexpected_no_content', status });
        }
      });
    }
  }
});

describe('request boundary and compatibility', () => {
  it('preserves webhook cursors and validates event guarantees', async () => {
    const client = new SupaOAuthClient({
      baseUrl: 'https://auth.example.test',
      fetch: async () => Response.json({ ...responses.listWebhookLogs, next_cursor: 'next-one' }),
    });
    expect((await client.listWebhookLogs('hook')).next_cursor).toBe('next-one');
    expect(() => decodeSchema(sdkEndpoints.listWebhookLogs.result, { items: [], total: 0 })).toThrow();
    expect(() => decodeSchema(sdkEndpoints.listWebhookEvents.result, { events: [] })).toThrow();
    expect(() => decodeSchema(sdkEndpoints.listWebhookEvents.result, {
      events: ['user.created'], catalog: [{ type: 'user.created', guarantee: 'best_effort' }],
    })).toThrow();
  });

  it('sends project-scoped compiler and partial password/nullable branding inputs unchanged', async () => {
    const sent: unknown[] = [];
    const client = new SupaOAuthClient({ baseUrl: 'https://auth.example.test', fetch: async (url, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return Response.json(String(url).includes('authorization-compiler')
        ? responses.compileAuthorizationPlan : responses.getSignInExperience);
    } });
    await client.compileAuthorizationPlan({ project_ref: 'project-one' });
    await client.updateSignInExperience({ branding: { logo_url: null, content: ['text', 42] }, password_policy: { min_length: 12 } });
    expect(sent).toEqual([
      { project_ref: 'project-one' },
      { branding: { logo_url: null, content: ['text', 42] }, password_policy: { min_length: 12 } },
    ]);
    expect(() => decodeSchema(sdkEndpoints.compileAuthorizationPlan.input, { body: { project_ref: 7 } })).toThrow();
  });

  it('validates tenant values against their configuration type in requests and responses', () => {
    expect(() => decodeSchema(sdkEndpoints.upsertTenantConfig.input, {
      params: { type: 'phrase', key: 'en' }, body: { value: { welcome: 12 } },
    })).toThrow();
    expect(() => decodeSchema(sdkEndpoints.getTenantConfig.result, {
      id: 'row', configType: 'account_center', key: 'default', enabled: true,
      value: { profile: { fields: [true] } },
    })).toThrow();
    expect(() => decodeSchema(sdkEndpoints.getTenantConfig.result, {
      id: 'row', configType: 'account_center', key: 'default', enabled: true,
      value: { profile: { edit_mode: 'editable', fields: ['name'] }, security: { mfa: true } },
    })).not.toThrow();
  });
  it('validates signup domain, provider and invitation policy fields on both boundaries', () => {
    const policy = {
      allowed_email_domains: ['example.test'], blocked_email_domains: ['blocked.test'],
      allowed_oauth_providers: ['github'], blocked_oauth_providers: ['google'],
      invite_only: true,
    };
    const input = { params: { type: 'auth_hook', key: 'signup_policy' }, body: { value: policy } };
    const result = { id: 'policy-row', configType: 'auth_hook', key: 'signup_policy', enabled: true, value: policy };
    expect(decodeSchema(sdkEndpoints.upsertTenantConfig.input, input)).toEqual(input);
    expect(decodeSchema(sdkEndpoints.getTenantConfig.result, result)).toEqual(result);
    for (const invalid of [
      { ...policy, allowed_email_domains: [7] }, { ...policy, blocked_email_domains: 'blocked.test' },
      { ...policy, allowed_oauth_providers: [false] }, { ...policy, blocked_oauth_providers: null },
      { ...policy, invite_only: 'true' },
    ]) {
      expect(() => decodeSchema(sdkEndpoints.upsertTenantConfig.input, {
        ...input, body: { value: invalid },
      })).toThrow();
      expect(() => decodeSchema(sdkEndpoints.getTenantConfig.result, { ...result, value: invalid })).toThrow();
    }
  });
  it('rejects malformed nested domain fields, not just the response root', async () => {
    const cases = [
      { invoke: invocations.listUsers, value: { ...responses.listUsers, items: [{ ...responses.getUser, app_metadata: [] }] } },
      { invoke: invocations.getRole, value: { ...responses.getRole, permissions: [{ id: 'id', name: false }] } },
      { invoke: invocations.getAuditExport, value: { ...responses.getAuditExport, filters: { ...responses.getAuditExport.filters, status: '200' } } },
      { invoke: invocations.getProvisioningStatus, value: { ...responses.getProvisioningStatus, steps: [{ step: 'config', status: 'success' }] } },
      { invoke: invocations.listTenantMembers, value: { ...responses.listTenantMembers, items: [{ ...responses.updateTenantMember, capabilities: [false] }] } },
      { invoke: invocations.getWebhookDelivery, value: { ...responses.getWebhookDelivery, status_code: '200' } },
      { invoke: invocations.getAuthHookStatus, value: { ...responses.getAuthHookStatus, registered: 'true' } },
      { invoke: invocations.compileAuthorizationPlan, value: { ...responses.compileAuthorizationPlan, sql: { helpers: 42 } } },
    ];
    for (const example of cases) {
      const fetcher = mock(async () => Response.json(example.value));
      const client = new SupaOAuthClient({ baseUrl: 'https://auth.example.test', fetch: fetcher });
      await expect(example.invoke(client)).rejects.toBeInstanceOf(SupaOAuthResponseContractError);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('rejects invalid domain inputs before fetch, including nested data', () => {
    const fetcher = mock(async () => Response.json(role));
    const client = new SupaOAuthClient({ baseUrl: 'https://auth.example.test', fetch: fetcher });
    const invalid = [
      () => client.createRole({ name: '' }),
      () => client.createRole({ name: 'Reader', permissions: ['same', 'same'] }),
      () => client.createApplication({ redirect_uris: [] }),
      () => client.getUser('..'),
    ];
    for (const invoke of invalid) expect(invoke).toThrow(SupaOAuthRequestContractError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects structurally invalid unknown inputs at the shared decoder boundary', () => {
    const invalid = [
      { schema: sdkEndpoints.updateTenantMember.input, value: { params: { memberId: 'member' }, body: { role: 'superuser' } } },
      { schema: sdkEndpoints.createUser.input, value: { body: { email_confirm: 'yes' } } },
      { schema: sdkEndpoints.createUser.input, value: { body: { user_metadata: { callback: () => 1 } } } },
      { schema: sdkEndpoints.compileAuthorizationPlan.input, value: { body: { tables: [{ table: 'documents', operations: ['execute'] }] } } },
      { schema: sdkEndpoints.updateOrganizationJitSettings.input, value: { params: { orgId: 'org' }, body: { enabled: true, domains: [1] } } },
      { schema: sdkEndpoints.listUsers.input, value: { query: { page: 'first' } } },
      { schema: sdkEndpoints.listUsers.input, value: { query: null } },
      { schema: sdkEndpoints.listUsers.input, value: { query: [] } },
      { schema: sdkEndpoints.listUsers.input, value: { query: { page: undefined } } },
      { schema: sdkEndpoints.updateAuthConfig.input, value: { body: { enable_signup: undefined } } },
      { schema: sdkEndpoints.updateUser.input, value: { params: { userId: 'user' }, body: { user_metadata: { changed_at: new Date() } } } },
    ];
    for (const { schema, value } of invalid) expect(() => decodeSchema(schema, value)).toThrow();
  });

  it('accepts nullable role descriptions and permissions without changing the JSON request', async () => {
    const fetcher = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ name: 'Reader', description: null, permissions: ['documents.read'] });
      return Response.json({ ...role, description: null });
    });
    const client = new SupaOAuthClient({ baseUrl: 'https://auth.example.test', fetch: fetcher });
    expect((await client.createRole({ name: 'Reader', description: null, permissions: ['documents.read'] })).description).toBeNull();
  });

  it('preserves trimmed role length semantics and user update extension fields', async () => {
    const padded = `  ${'x'.repeat(255)}  `;
    expect(() => decodeSchema(sdkEndpoints.createRole.input, { body: { name: padded, permissions: [padded] } })).not.toThrow();
    expect(() => decodeSchema(sdkEndpoints.createRole.input, { body: { name: ` ${'x'.repeat(256)} ` } })).toThrow();
    expect(() => decodeSchema(sdkEndpoints.createRole.input, { body: { name: '   ' } })).toThrow();
    const payload = { user_metadata: { display_name: 'Member' }, upstream_extension: { enabled: true } };
    const fetcher = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual(payload);
      return Response.json(responses.getUser);
    });
    const client = new SupaOAuthClient({ baseUrl: 'https://auth.example.test', fetch: fetcher });
    await client.updateUser('user', payload);
    expect(() => decodeSchema(sdkEndpoints.updateUser.input, {
      params: { userId: 'user' }, body: { email: false, upstream_extension: true },
    })).toThrow();
    expect(() => decodeSchema(sdkEndpoints.updateUser.input, {
      params: { userId: 'user' }, body: { upstream_extension: () => 1 },
    })).toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('shares optional empty body contracts with admin while preserving SDK serialization', async () => {
    expect(() => decodeSchema(sdkEndpoints.testWebhook.input, { params: { webhookId: 'id' } })).not.toThrow();
    expect(() => decodeSchema(sdkEndpoints.bindOrganizationApplication.input, { params: { orgId: 'id', appId: 'id' } })).not.toThrow();
    const fetcher = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.body).toBe('{}');
      return Response.json(responses.testWebhook);
    });
    await new SupaOAuthClient({ baseUrl: 'https://auth.example.test', fetch: fetcher }).testWebhook('id');
  });

  it('adds application query scope to user permissions and roles', async () => {
    const seen: string[] = [];
    const client = new SupaOAuthClient({ baseUrl: 'https://auth.example.test', fetch: async input => {
      const url = String(input);
      seen.push(url);
      return Response.json(url.includes('/permissions') ? responses.getUserPermissions : responses.getUserRoles);
    } });
    await client.getUserPermissions('user', 'org', 'app&other=1');
    await client.getUserRoles('user', 'app&other=1');
    for (const url of seen) expect(new URL(url).searchParams.get('application_id')).toBe('app&other=1');
  });

  it('declares real deletion wire receipts while preserving the SDK void result', async () => {
    const examples = [
      { name: 'deleteOrganization', result: { deleted: true, organization: responses.getOrganization } },
      { name: 'removeOrganizationMember', result: { deleted: true, member: responses.addOrganizationMember } },
      { name: 'removeTenantMember', result: { deleted: true, collaborator: responses.updateTenantMember } },
    ] as const;
    for (const example of examples) {
      const endpoint = sdkEndpoints[example.name];
      expect(() => decodeSchema(endpoint.wireResult, example.result)).not.toThrow();
      expect(() => decodeSchema(endpoint.wireResult, { deleted: true })).toThrow();
      const client = new SupaOAuthClient({ baseUrl: 'https://auth.example.test', fetch: async () => Response.json(example.result) });
      expect(await invocations[example.name](client)).toBeUndefined();
    }
  });

  it('accepts audit actors produced by platform project/anonymous principals', async () => {
    for (const actor_type of ['project', 'anonymous']) {
      const expected = { ...responses.getAuditLog, actor_type, request_id: null, event_hash: null };
      const client = new SupaOAuthClient({ baseUrl: 'https://auth.example.test', fetch: async () => Response.json(expected) });
      expect(await client.getAuditLog('audit')).toEqual(expected);
    }
  });

  it('never replays writes on HTTP or contract errors and keeps token updates explicit', async () => {
    const seen: Array<string | null> = [];
    const fetcher = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('Authorization'));
      return seen.length === 1 ? Response.json({ secret: 'redacted-token' }) : Response.json({ error: 'forbidden' }, { status: 403 });
    });
    const client = new SupaOAuthClient({ baseUrl: 'https://auth.example.test', accessToken: 'first', fetch: fetcher });
    await expect(client.createRole(bodies.createRole)).rejects.toBeInstanceOf(SupaOAuthResponseContractError);
    client.setAccessToken('second');
    await expect(client.createRole(bodies.createRole)).rejects.toBeInstanceOf(SupaOAuthAPIError);
    expect(seen).toEqual(['Bearer first', 'Bearer second']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('normalizes all HeadersInit forms without dropping cancellation or custom headers', async () => {
    const controller = new AbortController();
    const fetcher = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('X-Trace')).toBe('trace');
      expect(init?.signal).toBe(controller.signal);
      return Response.json(role);
    });
    const client = new SupaOAuthClient({ baseUrl: 'https://auth.example.test', fetch: fetcher });
    const variants: HeadersInit[] = [new Headers({ 'X-Trace': 'trace' }), [['X-Trace', 'trace']], { 'X-Trace': 'trace' }];
    for (const headers of variants) {
      await client.requestDecoded('/custom', value => decodeSchema(Type.Object({ id: Type.String() }), value), { headers, signal: controller.signal });
    }
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

it('redacts early application schema failures without calling transport', () => {
  const fetcher = mock(async () => Response.json({}));
  const client = new SupaOAuthClient({ baseUrl: 'https://auth.example.test', fetch: fetcher });
  const invalidCalls = [
    // @ts-expect-error Exercise untyped input at the public SDK boundary.
    () => client.createApplication({ redirect_uris: [42] }),
    // @ts-expect-error Exercise untyped input at the public SDK boundary.
    () => client.updateApplication('app-1', { redirect_uris: [42] }),
  ];
  for (const invoke of invalidCalls) {
    expect(invoke).toThrow(SupaOAuthRequestContractError);
    try {
      invoke();
    } catch (error) {
      expect(error).toBeInstanceOf(SupaOAuthRequestContractError);
      if (error instanceof Error) {
        expect(error.message).toBe(new SupaOAuthRequestContractError().message);
        expect(error.cause).toBeUndefined();
      }
    }
  }
  expect(fetcher).not.toHaveBeenCalled();
});
