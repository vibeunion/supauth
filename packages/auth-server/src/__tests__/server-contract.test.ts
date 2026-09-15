import { strictDefined } from './helpers/strict-values.js';
import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { Type, type Static } from '../../../shared/src/schema.js';
import { sdkEndpoints } from '../../../shared/src/sdk-endpoints.js';
import { serverManagementContracts } from '../../../shared/src/server-management.js';
import { commonServerErrors, decodeServerInput, type ServerRouteContract } from '../../../shared/src/server-contracts.js';
import { serverContract, validateServerResponse } from '../utils/server-contract.js';
import { decodeEndpointBody, decodeEndpointInput, decodeManagementBody, decodeResponseValue, decodeEndpointResponse } from '../utils/management-contract.js';
import { ApiContractError } from '../utils/api-contract.js';
import { observabilityMiddleware } from '../middleware/index.js';
import { fixtureOrganization } from './management-contract-fixtures.js';

const contract: ServerRouteContract = {
  request: 'validated',
  input: Type.Object({ body: Type.Object({ name: Type.String() }) }),
  responses: {
    ...commonServerErrors,
    200: { kind: 'validated', schema: Type.Object({ id: Type.String() }), contentTypes: ['application/json'] },
    403: { kind: 'protocol', schema: Type.Literal('disabled'), contentTypes: ['text/plain'] },
  },
};

function request(body: unknown) {
  return new Request('http://localhost/resource', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('server contract execution', () => {
  test('validates input before invoking the mutation without transforming it', async () => {
    let calls = 0;
    const app = new Elysia().post('/resource', ({ body }) => {
      calls++;
      expect(body).toEqual({ name: 'a', custom: 'preserved' });
      return { id: 'one' };
    }, serverContract('test:create', { contract }));
    const rejected = await app.handle(request({ name: 123 }));
    expect(rejected.status).toBe(400);
    expect(calls).toBe(0);
    const accepted = await app.handle(request({ name: 'a', custom: 'preserved' }));
    expect(accepted.status).toBe(200);
    expect(calls).toBe(1);
  });

  test('global authentication remains ahead of local contract validation', async () => {
    const app = new Elysia()
      .onBeforeHandle(() => new Response('Unauthorized', { status: 401 }))
      .post('/resource', () => ({ id: 'one' }), serverContract('test:auth', { contract }));
    expect((await app.handle(request({ name: 123 }))).status).toBe(401);
  });

  test('allows existing domain validation to retain its failure precedence', async () => {
    let calls = 0;
    const app = new Elysia().post('/resource', () => {
      calls++;
      return { id: 'one' };
    }, serverContract('test:precedence', {
      contract,
      beforeValidate: () => new Response('disabled', { status: 403 }),
    }));
    expect((await app.handle(request({ name: 123 }))).status).toBe(403);
    expect(calls).toBe(0);
  });

  test('native Response cannot bypass JSON domain validation', async () => {
    await expect(validateServerResponse(contract, Response.json({ id: 123 }))).rejects.toMatchObject({
      status: 502,
      code: 'invalid_upstream_response',
    });
    const response = Response.json({ id: 'one' }, { headers: { 'x-proof': 'kept' } });
    await validateServerResponse(contract, response);
    expect(response.headers.get('x-proof')).toBe('kept');
    expect(await response.json()).toEqual({ id: 'one' });
  });

  test('checks native HTTP status and media type, not only JSON syntax', async () => {
    await expect(validateServerResponse(contract, new Response('{"id":"one"}', {
      headers: { 'content-type': 'text/html' },
    }))).rejects.toThrow();
    await expect(validateServerResponse(contract, Response.json({ id: 'one' }, { status: 201 }))).rejects.toThrow();
    await expect(validateServerResponse(contract, new Response('bad-json', {
      headers: { 'content-type': 'application/json' },
    }))).rejects.toThrow();
  });

  test('response schemas also execute through actual Elysia hooks', async () => {
    const app = new Elysia()
      .post('/resource', () => Response.json({ id: false }), serverContract('test:native', { contract }));
    expect((await app.handle(request({ name: 'valid' }))).status).not.toBe(200);
  });

  test('serializes dates for validation without replacing the returned domain value', async () => {
    const result = { at: new Date('2026-09-08T00:00:00.000Z') };
    await validateServerResponse({
      ...contract,
      responses: { 200: { kind: 'validated', schema: Type.Object({ at: Type.String() }) } },
    }, result);
    expect(result.at).toBeInstanceOf(Date);
  });

  test('empty responses cannot carry an undeclared payload', async () => {
    const empty: ServerRouteContract = { ...contract, responses: { 204: { kind: 'empty' } } };
    await validateServerResponse(empty, new Response(null, { status: 204 }));
    await expect(validateServerResponse({ ...empty, responses: { 200: { kind: 'empty' } } }, Response.json({ id: 'bad' }))).rejects.toThrow();
  });

  test('explicit same-status JSON and empty alternatives preserve missing-update behavior', async () => {
    const mixed: ServerRouteContract = {
      ...contract,
      responses: {
        200: { kind: 'protocol', alternatives: [strictDefined(contract.responses[200]), { kind: 'empty' }] },
      },
    };
    await validateServerResponse(mixed, undefined);
    await validateServerResponse(mixed, { id: 'one' });
    await validateServerResponse(mixed, new Response(null));
    await expect(validateServerResponse(mixed, Response.json({ id: 12 }))).rejects.toThrow();
    expect(serverContract('test:mixed', { contract: mixed }).detail['x-supauth-contract'].response).toBe('protocol');
  });

  test('binary and redirect branches require their actual transport contract', async () => {
    await validateServerResponse({
      ...contract,
      responses: { 200: { kind: 'binary', contentTypes: ['application/octet-stream'] } },
    }, new Response(new Uint8Array([1]), { headers: { 'content-type': 'application/octet-stream' } }));
    const redirect: ServerRouteContract = {
      ...contract,
      responses: { 307: { kind: 'redirect', schema: Type.String({ minLength: 1 }) } },
    };
    await validateServerResponse(redirect, new Response(null, { status: 307, headers: { location: '/login' } }));
    await expect(validateServerResponse(redirect, new Response(null, { status: 307 }))).rejects.toThrow();
  });

  test('metadata is emitted alongside the executable schema, including hidden routes', () => {
    const options = serverContract('test:hidden', {
      contract: { ...contract, hidden: true, retired: true },
      detail: { summary: 'preserved' },
    });
    expect(options.detail['x-supauth-contract']).toEqual({
      request: 'validated', response: 'validated', source: 'test:hidden', retired: true,
    });
    expect(options.detail.hide).toBe(true);
    expect(options.detail).toMatchObject({ summary: 'preserved' });
    expect(typeof options.beforeHandle).toBe('function');
    expect(typeof options.afterHandle).toBe('function');
  });

  test('OpenAPI request schemas come from the same executable input schema', () => {
    const input = Type.Object({
      params: Type.Object({ id: Type.String() }),
      query: Type.Optional(Type.Object({ limit: Type.Optional(Type.Number()) })),
      headers: Type.Object({ authorization: Type.String() }),
      body: Type.Optional(Type.Object({ note: Type.String() })),
    });
    const options = serverContract('test:documentation', { contract: { ...contract, input } });
    expect(options.detail.requestBody?.required).toBe(false);
    expect(options.detail.requestBody?.content['application/json'].schema).toBe(input.properties.body);
    expect(options.detail.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: input.properties.params.properties.id },
      { name: 'limit', in: 'query', required: false, schema: input.properties.query.properties.limit },
      { name: 'authorization', in: 'header', required: true, schema: input.properties.headers.properties.authorization },
    ]);
  });

  test('top-level discriminated input unions preserve runtime correlation and document every location', async () => {
    const input = Type.Union([
      Type.Object({
        params: Type.Object({ type: Type.Literal('limits'), key: Type.String() }),
        body: Type.Object({ value: Type.Object({ limit: Type.Number() }) }),
      }),
      Type.Object({
        params: Type.Object({ type: Type.Literal('branding'), key: Type.String() }),
        body: Type.Object({ value: Type.Object({ title: Type.String() }) }),
        headers: Type.Optional(Type.Object({ 'x-proof': Type.String() })),
      }),
    ]);
    const options = serverContract('test:union', { contract: { ...contract, input } });
    const base = { request: new Request('http://localhost/'), set: {} };
    await options.beforeHandle({ ...base, params: { type: 'limits', key: 'one' }, body: { value: { limit: 3 } } });
    await options.beforeHandle({ ...base, params: { type: 'branding', key: 'one' }, body: { value: { title: 'Brand' } } });
    await expect(options.beforeHandle({
      ...base, params: { type: 'limits', key: 'one' }, body: { value: { title: 'incorrect branch' } },
    })).rejects.toMatchObject({ status: 400 });
    expect(options.detail['x-supauth-input-schema']).toBe(input);
    expect(options.detail.requestBody?.required).toBe(true);
    expect(options.detail.requestBody?.content['application/json'].schema["anyOf"]).toHaveLength(2);
    expect(options.detail.parameters?.map(parameter => `${parameter.in}:${parameter.name}`)).toEqual([
      'path:type', 'path:key', 'header:x-proof',
    ]);
    expect(options.detail.parameters?.find(parameter => parameter.name === 'x-proof')?.required).toBe(false);
  });

  test('omits absent optional input keys but rejects explicit nested undefined', async () => {
    const optional = { ...contract, input: Type.Object({ body: Type.Optional(Type.Object({ note: Type.Optional(Type.String()) })) }) };
    const options = serverContract('test:optional', { contract: optional });
    await options.beforeHandle({ request: new Request('http://localhost/'), set: {} });
    expect(() => decodeServerInput(optional, { body: { note: undefined } })).toThrow();
    expect(() => decodeServerInput(optional, { body: {} })).not.toThrow();
    expect(() => decodeServerInput(optional, { body: undefined })).toThrow();
    await expect(options.beforeHandle({
      body: { note: undefined }, request: new Request('http://localhost/'), set: {},
    })).rejects.toMatchObject({ status: 400 });
  });

  test('plain void is preserved and response validation uses JSON wire semantics', async () => {
    await validateServerResponse({
      ...contract, responses: { 200: { kind: 'validated', schema: Type.Void() } },
    }, undefined);
    await validateServerResponse({
      ...contract, responses: { 200: { kind: 'validated', schema: Type.Object({ id: Type.String() }, { additionalProperties: false }) } },
    }, { id: 'one', optional: undefined });
  });

  test('input validation rejects accessors and cycles without evaluating user code', () => {
    let reads = 0;
    const body = Object.defineProperty({}, 'name', {
      enumerable: true,
      get() { reads += 1; return 'private-value'; },
    });
    expect(() => decodeServerInput(contract, { body })).toThrow();
    expect(reads).toBe(0);
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(() => decodeServerInput(contract, cyclic)).toThrow('Response does not match the expected schema.');
    expect(() => decodeServerInput({ ...contract, input: Type.Void() }, undefined)).toThrow();
  });

  test('requires concrete contracts for every nested response alternative', () => {
    for (const branch of [
      { kind: 'protocol', alternatives: [{ kind: 'validated' }] },
      { kind: 'protocol', alternatives: [] },
      { kind: 'validated', alternatives: [{ kind: 'empty' }] },
      { kind: 'binary' },
    ] as const) {
      expect(() => serverContract('test:invalid-branch', { contract: { ...contract, responses: { 200: branch } } })).toThrow();
    }
  });

  test('multipart protocol verifier receives untouched input outside the JSON decoder', async () => {
    const body = new FormData();
    body.append('file', new Blob(['data']), 'file.txt');
    let verified = false;
    const rawContract: ServerRouteContract = { ...contract, request: 'protocol' };
    expect(() => serverContract('test:raw', { contract: rawContract })).toThrow();
    const options = serverContract('test:raw', {
      contract: rawContract,
      beforeValidate: (context) => {
        expect(context.body).toBe(body);
        expect(body.get('file')).toBeInstanceOf(Blob);
        verified = true;
      },
    });
    await options.beforeHandle({ body, request: new Request('http://localhost/'), set: {} });
    expect(verified).toBe(true);
    await expect(serverContract('test:json', { contract }).beforeHandle({
      body, request: new Request('http://localhost/'), set: {},
    })).rejects.toThrow();
  });

  test('central errors validate serialized optional details without changing the envelope', async () => {
    const app = new Elysia().use(observabilityMiddleware).get('/error', () => {
      throw new ApiContractError(409, 'binding_conflict', 'Conflict', { binding_count: 1, field: undefined });
    });
    const response = await app.handle(new Request('http://localhost/error'));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      success: false, error: { code: 'binding_conflict', message: 'Conflict', details: { binding_count: 1 } },
    });
  });

  test('SDK deletion void results use concrete upstream JSON contracts on the server', async () => {
    for (const name of ['deleteOrganization', 'removeOrganizationMember', 'removeTenantMember'] as const) {
      const endpoint = sdkEndpoints[name];
      const entry = strictDefined(serverManagementContracts[`${endpoint.method} ${endpoint.path}`]);
      expect(entry.gap).toBeUndefined();
      expect(entry.contract.responses[200]?.schema).toBe(endpoint.wireResult);
      expect(entry.contract.responses[200]?.kind).toBe('validated');
      await expect(validateServerResponse(entry.contract, Response.json({ deleted: true }))).rejects.toThrow();
    }
    expect(Object.keys(serverManagementContracts)).toHaveLength(96);
    expect(Object.values(serverManagementContracts).filter(entry => entry.gap)).toHaveLength(0);
  });

  test('typed readers retain endpoint-specific static types and reject invalid values', () => {
    const body = decodeEndpointBody('createResource', { name: 'API', indicator: 'https://api.example.test' });
    const name: string = body.name;
    // @ts-expect-error 具体 endpoint 的字符串字段不能退化为 any。
    const incorrect: number = body.name;
    void incorrect;
    expect(name).toBe('API');
    const input = decodeEndpointInput('getUserPermissions', { params: { userId: 'user' }, query: { org_id: 'org' } });
    const org: string | undefined = input.query?.org_id;
    expect(org).toBe('org');
    const serverBody = decodeManagementBody('createOrganization', { name: 'Org', slug: 'org', jit_domains: [] });
    const domains: string[] | undefined = serverBody.jit_domains;
    expect(domains).toEqual([]);
    const result: Static<typeof sdkEndpoints.createResource.result> = decodeResponseValue(
      sdkEndpoints.createResource.result,
      { id: 'resource', name: 'API', indicator: 'https://api.example.test', description: null, createdAt: new Date(), updatedAt: new Date(), scopes: [] },
    );
    expect(result.id).toBe('resource');
    const deleted = decodeEndpointResponse('deleteOrganization', {
      deleted: true,
      organization: fixtureOrganization(),
    });
    const deletedId: string = deleted.organization.id;
    // @ts-expect-error SDK void 不得擦除服务端的具体 wireResult。
    const wrongId: number = deleted.organization.id;
    void wrongId;
    expect(deletedId).toBe('one');
    expect(() => decodeEndpointBody('createResource', { name: 1 })).toThrow();
    expect(() => decodeManagementBody('createOrganization', { name: 'Org', jit_domains: [undefined] })).toThrow();
  });
});
