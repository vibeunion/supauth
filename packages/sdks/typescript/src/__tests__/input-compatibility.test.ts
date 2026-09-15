import { describe, expect, test } from 'bun:test';
import { SupaOAuthClient, SupaOAuthRequestContractError } from '../index.js';
import { responses } from './domain-fixtures.js';
import { decodeSchema, sdkEndpoints } from '@supauth/shared';

describe('legacy successful SDK wire inputs', () => {
  test('serializes resource text/null descriptions and rejects invalid types before transport', async () => {
    const sent: unknown[] = [];
    const client = new SupaOAuthClient({
      baseUrl: 'https://auth.example.test',
      fetch: async (_url, init) => {
        sent.push(typeof init?.body === 'string' ? JSON.parse(init.body) : undefined);
        return Response.json(responses.createResource);
      },
    });
    for (const description of ['Document API', '', null]) {
      const input = { name: 'Documents', indicator: 'https://api.example.test', description };
      await client.createResource(input);
      expect(sent.at(-1)).toEqual(input);
      await client.updateResource('resource-one', { description });
      expect(sent.at(-1)).toEqual({ description });
    }
    // @ts-expect-error 资源描述的具体文本契约必须在传输前校验。
    expect(() => client.createResource({ name: 'Documents', indicator: 'https://api.example.test', description: {} }))
      .toThrow(SupaOAuthRequestContractError);
    // @ts-expect-error 更新不能把数字当成可空文本。
    expect(() => client.updateResource('resource-one', { description: 42 })).toThrow(SupaOAuthRequestContractError);
    expect(sent).toHaveLength(6);
  });

  test('serializes the specific nullable legacy fields without converting them to omission', async () => {
    const sent: unknown[] = [];
    let result: unknown;
    const client = new SupaOAuthClient({
      baseUrl: 'https://auth.example.test',
      fetch: async (_url, init) => {
        sent.push(typeof init?.body === 'string' ? JSON.parse(init.body) : undefined);
        return Response.json(result);
      },
    });
    const resourceInput = { name: 'Documents', indicator: 'https://api.example.test', scopes: [{ name: 'read', description: null }] };
    result = responses.createResource;
    await client.createResource(resourceInput);
    expect(sent.at(-1)).toEqual(resourceInput);
    result = responses.addScope;
    await client.addScope('resource-one', { name: 'read', description: null });
    expect(sent.at(-1)).toEqual({ name: 'read', description: null });
    result = responses.updateScope;
    await client.updateScope('resource-one', 'scope-one', { description: null });
    expect(sent.at(-1)).toEqual({ description: null });
    const factory = { name: 'Example', protocol: 'oidc', category: 'enterprise_sso', config_schema: null, enabled: null };
    result = responses.upsertConnectorFactory;
    await client.upsertConnectorFactory('oidc', factory);
    expect(sent.at(-1)).toEqual(factory);
    const enterprise = {
      connector_id: 'connector-one', domains: ['example.test'],
      jit_provisioning: null, org_membership_mapping: null, role_mapping: null,
    };
    result = responses.createEnterpriseSSOConfig;
    await client.createEnterpriseSSOConfig(enterprise);
    expect(sent.at(-1)).toEqual(enterprise);
    result = responses.updateSignInExperience;
    await client.updateSignInExperience({ branding: null, password_policy: null });
    expect(sent.at(-1)).toEqual({ branding: null, password_policy: null });
    result = responses.updateApplicationSignInExperience;
    await client.updateApplicationSignInExperience('app-one', { branding: null });
    expect(sent.at(-1)).toEqual({ branding: null });
    result = responses.upsertTenantConfig;
    await client.upsertTenantConfig('domain', 'default', { value: null, enabled: null });
    expect(sent.at(-1)).toEqual({ value: null, enabled: null });
    // @ts-expect-error 非空错误类型仍必须在发出请求之前拒绝。
    expect(() => client.upsertTenantConfig('domain', 'default', { enabled: 'true' }))
      .toThrow(SupaOAuthRequestContractError);
    expect(sent).toHaveLength(8);
  });

  test('nullable inputs do not widen normalized response containers or malformed input fields', () => {
    const cases = [
      [sdkEndpoints.addScope.input, { params: { resourceId: 'r' }, body: { name: 'read', description: 42 } }],
      [sdkEndpoints.upsertConnectorFactory.input, {
        params: { factoryId: 'f' }, body: { name: 'Example', protocol: 'oidc', category: 'enterprise_sso', enabled: 'true' },
      }],
      [sdkEndpoints.createEnterpriseSSOConfig.input, {
        body: { connector_id: 'c', domains: ['example.test'], role_mapping: { 'line\nbreak': 42 } },
      }],
      [sdkEndpoints.updateSignInExperience.input, { body: { password_policy: [] } }],
      [sdkEndpoints.updateApplicationSignInExperience.result, { ...responses.updateApplicationSignInExperience, branding: null }],
      [sdkEndpoints.updateSignInExperience.result, { ...responses.updateSignInExperience, password_policy: null }],
      [sdkEndpoints.createEnterpriseSSOConfig.result, { id: 'sso', domains: [], role_mapping: null }],
    ] as const;
    for (const [schema, value] of cases) expect(() => decodeSchema(schema, value)).toThrow();
  });

  test('omits absent resource body without injecting undefined or retrying', async () => {
    const sent: Array<RequestInit | undefined> = [];
    const urls: string[] = [];
    const client = new SupaOAuthClient({
      baseUrl: 'https://auth.example.test',
      fetch: async (url, init) => {
        urls.push(String(url));
        sent.push(init);
        return Response.json(responses.updateResource);
      },
    });
    await client.updateResource('resource/one');
    expect(sent).toHaveLength(1);
    expect(urls).toEqual(['https://auth.example.test/v1/resources/resource%2Fone']);
    expect(sent[0]?.body).toBeUndefined();
    await client.updateResource('resource/one', {});
    expect(sent[1]?.body).toBe('{}');
  });

  test('passes opaque OAuth type through while retaining JSON safety', async () => {
    const sent: unknown[] = [];
    const client = new SupaOAuthClient({
      baseUrl: 'https://auth.example.test',
      fetch: async (_url, init) => {
        sent.push(typeof init?.body === 'string' ? JSON.parse(init.body) : null);
        return Response.json(responses.createApplication);
      },
    });
    for (const type of ['service', null, { custom: [1, true] }]) {
      await client.createApplication({ redirect_uris: ['https://client.example.test/callback'], type });
      expect(sent.at(-1)).toEqual({ redirect_uris: ['https://client.example.test/callback'], type });
    }
    expect(() => decodeSchema(sdkEndpoints.createApplication.input, {
      body: { redirect_uris: ['https://client.example.test/callback'], type: { invalid: undefined } },
    })).toThrow();
    expect(() => decodeSchema(sdkEndpoints.createApplication.input, {
      body: { redirect_uris: ['https://client.example.test/callback'], type: new Date() },
    })).toThrow();
  });

  test('permits null defaults and normalized collaborator spellings in the shared wire contract', () => {
    const cases = [
      [sdkEndpoints.upsertTenantConfig.input, { params: { type: 'domain', key: 'default' }, body: { value: null } }],
      [sdkEndpoints.upsertTenantConfig.input, { params: { type: 'domain', key: 'default' }, body: { enabled: null } }],
      [sdkEndpoints.updateApplicationConsentSettings.input, {
        params: { appId: 'app' }, body: { user_scopes: null, custom_data: null, require_explicit_consent: null },
      }],
      [sdkEndpoints.updateTenantMember.input, { params: { memberId: 'member' }, body: { role: ' AdMiN ', status: '' } }],
      [sdkEndpoints.createTenantInvitation.input, { body: { email: 'admin@example.test', role: ' VIEWER ' } }],
      [sdkEndpoints.suspendUser.input, { params: { userId: 'user' } }],
    ] as const;
    for (const [schema, input] of cases) expect(decodeSchema(schema, input)).toEqual(input);
  });

  test('rejects unsupported collaborator roles and unsafe paths before transport', () => {
    let calls = 0;
    const client = new SupaOAuthClient({
      baseUrl: 'https://auth.example.test',
      fetch: async () => { calls++; return Response.json(responses.updateTenantMember); },
    });
    expect(() => client.updateTenantMember('member', { role: 'superuser' })).toThrow(SupaOAuthRequestContractError);
    for (const path of ['', '.', '..']) {
      expect(() => client.updateResource(path)).toThrow(SupaOAuthRequestContractError);
    }
    expect(calls).toBe(0);
  });

  test('keeps opaque path schemas separate from URL construction guards', () => {
    for (const appId of ['', '.', '..', 'vendor/app', 'app\nid']) {
      expect(decodeSchema(sdkEndpoints.getApplication.input, { params: { appId } })).toEqual({ params: { appId } });
    }
    expect(() => decodeSchema(sdkEndpoints.getApplication.input, { params: { appId: 1 } })).toThrow();
  });
});
