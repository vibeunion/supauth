import { parseJsonRecord, requireDefined } from '../scripts/tooling-values.js';
import { Type, decodeSchema } from '../packages/shared/src/schema.js';
import { describe, expect, test } from 'bun:test';
import { createRouteContractInventory, decodeRouteContractInventory, inspectContractCoverage, isConcreteSchema, normalizeContractPath } from '../scripts/type-safety-contract.js';

const entity = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] };
function specification(overrides: Record<string, unknown> = {}) {
  return {
    openapi: '3.0.3',
    paths: {
      '/v1/roles/': {
        get: {
          'x-supauth-contract': { request: 'none', response: 'validated', source: 'shared.roles.list' },
          responses: { '200': { content: { 'application/json': { schema: entity } } } },
          ...overrides,
        },
      },
    },
  };
}

describe('complete route contract inventory', () => {
  test('root infrastructure retains real plugin routes, visibility and transport behavior', () => {
    const probe = Bun.spawnSync([process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', '-e', `
      const { app } = await import("./packages/auth-server/src/index.ts");
      const { createRouteContractInventory } = await import("./scripts/type-safety-contract.ts");
      const { parseJsonRecord } = await import("./scripts/tooling-values.ts");
      const routes = app.routes.filter(route => route.method === "OPTIONS" || route.path.startsWith("/swagger"));
      const responses = [];
      for (const [method, path] of [["OPTIONS", "/"], ["OPTIONS", "/unregistered"], ["GET", "/swagger"], ["GET", "/swagger/json"]]) {
        const response = await app.handle(new Request("http://localhost" + path, {
          method, headers: { origin: "http://localhost:3000", "access-control-request-method": "POST" },
        }));
        const text = await response.text();
        responses.push({ method, path, status: response.status, type: response.headers.get("content-type"),
          credentials: response.headers.get("access-control-allow-credentials"), empty: text.length === 0,
          openapi: path.endsWith("/json") ? parseJsonRecord(text)["openapi"] : undefined });
      }
      console.log(JSON.stringify({ inventory: routes.map(createRouteContractInventory), responses }));
      process.exit(0);
    `], {
      cwd: new URL('..', import.meta.url).pathname,
      env: {
        PATH: process.env["PATH"] ?? '', BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0',
        PORT: '0', SUPACLOUD_API_URL: 'http://localhost:9090', SUPACLOUD_MASTER_TOKEN: 'export-placeholder',
        PROJECT_REF: 'export-placeholder', DATABASE_URL: 'postgres://placeholder', HOST: '127.0.0.1',
      },
      timeout: 20_000,
      stdout: 'pipe', stderr: 'pipe',
    });
    expect(probe.exitCode).toBe(0);
    const result = parseJsonRecord(new TextDecoder().decode(probe.stdout));
    const inventory = decodeRouteContractInventory(result['inventory']);
    const responses = decodeSchema(Type.Array(Type.Object({
      status: Type.Integer({ minimum: 100, maximum: 599 }),
      empty: Type.Boolean(),
      credentials: Type.Union([Type.String(), Type.Null()]),
      type: Type.Union([Type.String(), Type.Null()]),
      openapi: Type.Optional(Type.String()),
    })), result['responses']);
    expect(inventory.map(route => ({
      method: route.method, path: route.path, hidden: route.hidden, contract: route.contract,
    }))).toEqual([
      { method: 'OPTIONS', path: '/', hidden: true, contract: { request: 'protocol', response: 'empty', source: 'infra.cors.preflight' } },
      { method: 'OPTIONS', path: '/*', hidden: true, contract: { request: 'protocol', response: 'empty', source: 'infra.cors.preflight' } },
      { method: 'GET', path: '/swagger', hidden: true, contract: { request: 'none', response: 'html', source: 'infra.swagger.ui' } },
      { method: 'GET', path: '/swagger/json', hidden: true, contract: { request: 'none', response: 'protocol', source: 'infra.swagger.openapi' } },
    ]);
    for (const response of responses.slice(0, 2)) {
      expect(response.status).toBe(204);
      expect(response.empty).toBe(true);
      expect(response.credentials).toBe('true');
    }
    expect(requireDefined(responses[2]).status).toBe(200);
    expect(requireDefined(responses[2]).type).toContain('text/html');
    expect(requireDefined(responses[3]).status).toBe(200);
    expect(requireDefined(responses[3]).openapi).toBe('3.0.3');
    expect(inspectContractCoverage(specification(), inventory)).toEqual({ total: 5, covered: 5, hidden: 4, issues: [] });
  });

  test('normalizes Elysia and OpenAPI paths without counting trailing-slash aliases twice', () => {
    expect(normalizeContractPath('/v1/roles/:roleId/')).toBe('/v1/roles/{roleId}');
    const result = inspectContractCoverage(specification(), [{ method: 'GET', path: '/v1/roles', hidden: false }]);
    expect(result).toEqual({ total: 1, covered: 1, hidden: 0, issues: [] });
  });

  test('does not accept documentation alone as evidence of connected validation', () => {
    expect(inspectContractCoverage(specification({ 'x-supauth-contract': undefined })).issues)
      .toEqual([{ operation: 'GET /v1/roles', code: 'missing_contract' }]);
  });

  test('does not discard hidden and retired routes from the denominator', () => {
    const result = inspectContractCoverage(specification(), [{ method: 'POST', path: '/v1/retired', hidden: true }]);
    expect(result.total).toBe(2);
    expect(result.hidden).toBe(1);
    expect(result.covered).toBe(1);
    expect(result.issues).toContainEqual({ operation: 'POST /v1/retired', code: 'missing_contract' });
  });

  test('requires deliberate classification for non-JSON boundaries', () => {
    const result = inspectContractCoverage(specification(), [{
      method: 'GET', path: '/login', hidden: true,
      contract: { request: 'protocol', response: 'html', source: 'hosted-pages' },
    }]);
    expect(result.covered).toBe(2);
    expect(result.issues).toEqual([]);
  });

  test('requires every advertised success response to have a concrete schema', () => {
    const result = inspectContractCoverage(specification({
      responses: { '200': { content: { 'application/json': { schema: entity } } }, '201': {} },
    }));
    expect(result.issues).toContainEqual({ operation: 'GET /v1/roles', code: 'missing_response_schema' });
  });

  test('rejects arbitrary records and empty schemas as domain contracts', () => {
    for (const schema of [{}, { type: 'object' }, { type: 'object', additionalProperties: true }, { type: 'array', items: {} }]) {
      expect(isConcreteSchema(schema)).toBe(false);
    }
    expect(isConcreteSchema({ type: 'array', items: entity })).toBe(true);
  });

  test('resolves local schema references and rejects unresolved references', () => {
    expect(isConcreteSchema({ $ref: '#/components/schemas/Role' }, { components: { schemas: { Role: entity } } })).toBe(true);
    expect(isConcreteSchema({ $ref: '#/components/schemas/Missing' })).toBe(false);
    expect(isConcreteSchema({ $ref: 'https://example.invalid/schema' })).toBe(false);
    expect(isConcreteSchema({ $ref: '#/components/schemas/Loop' }, {
      components: { schemas: { Loop: { $ref: '#/components/schemas/Loop' } } },
    })).toBe(false);
  });

  test('requires request schema when runtime request validation is claimed', () => {
    const result = inspectContractCoverage(specification({
      'x-supauth-contract': { request: 'validated', response: 'validated', source: 'shared.roles' },
    }));
    expect(result.issues).toContainEqual({ operation: 'GET /v1/roles', code: 'missing_request_schema' });
  });

  test('rejects incomplete or fabricated classification values', () => {
    const result = inspectContractCoverage(specification({
      'x-supauth-contract': { request: 'unchecked', response: 'validated', source: '' },
    }));
    expect(result.issues).toContainEqual({ operation: 'GET /v1/roles', code: 'invalid_contract' });
  });

  test('fails closed when supplied an empty or invalid OpenAPI document', () => {
    for (const value of [null, {}, { paths: {} }, { paths: { '/': {} } }]) {
      expect(() => inspectContractCoverage(value)).toThrow('OpenAPI document has no operations');
    }
  });
});

const jsonContent = (schema: unknown) => ({ content: { 'application/json': { schema } } });
const validatedContract = { request: 'validated', response: 'validated', source: 'fixture.domain' };
const responseOperation = (schema: unknown) => ({
  'x-supauth-contract': { ...validatedContract, request: 'none' },
  responses: { '200': jsonContent(schema) },
});

describe('recursive schema quality (F2)', () => {
  test('checks schema-bearing siblings even when their type is supplied by allOf or a reference (Locke F2)', () => {
    const document = { components: { schemas: { Entity: entity, Rows: { type: 'array', items: entity } } } };
    for (const schema of [
      { allOf: [entity], properties: { payload: {} } },
      { $ref: '#/components/schemas/Entity', properties: { payload: { $ref: '#/components/schemas/Missing' } } },
      { allOf: [{ type: 'array', items: entity }], items: {} },
      { $ref: '#/components/schemas/Rows', items: { $ref: '#/components/schemas/Missing' } },
      { $ref: '#/components/schemas/Entity', additionalProperties: {} },
      { allOf: [entity], patternProperties: { '.*': {} } },
      { allOf: [entity], properties: null },
    ]) {
      expect(isConcreteSchema(schema, document)).toBe(false);
      expect(inspectContractCoverage({ ...specification(responseOperation(schema)), ...document }).covered).toBe(0);
    }
    for (const schema of [
      { allOf: [entity], properties: { name: { type: 'string' } } },
      { $ref: '#/components/schemas/Entity', properties: { child: { $ref: '#/components/schemas/Entity' } } },
      { $ref: '#/components/schemas/Rows', items: entity },
    ]) {
      expect(isConcreteSchema(schema, document)).toBe(true);
    }
  });

  test('checks declared conditional, tuple and definition schemas without treating annotations as schemas', () => {
    for (const sibling of [
      { prefixItems: [{}] }, { additionalItems: {} }, { contains: {} }, { propertyNames: {} },
      { unevaluatedProperties: {} }, { unevaluatedItems: {} }, { not: {} },
      { if: {} }, { then: { $ref: '#/missing' } }, { else: {} },
      { $defs: { Invalid: {} } }, { definitions: { Invalid: {} } },
      { dependentSchemas: { metadata: {} } }, { dependencies: { metadata: {} } },
    ]) {
      expect(isConcreteSchema({ allOf: [entity], ...sibling })).toBe(false);
    }
    expect(isConcreteSchema({ ...entity, examples: [{}], default: {}, description: 'domain' })).toBe(true);
    expect(isConcreteSchema({
      type: 'array', prefixItems: [{ type: 'string' }, entity], items: false,
    })).toBe(true);
    expect(isConcreteSchema({ ...entity, dependencies: { id: ['name'] } })).toBe(true);
  });

  test('distinguishes an exact closed empty command from an arbitrary object', () => {
    const closed = { type: 'object', properties: {}, additionalProperties: false };
    const nullable = { anyOf: [{ type: 'null' }, closed] };
    expect(isConcreteSchema(closed)).toBe(true);
    expect(isConcreteSchema(nullable)).toBe(true);
    expect(isConcreteSchema({ type: 'object', additionalProperties: false })).toBe(true);
    expect(isConcreteSchema({ ...closed, required: ['missing'] })).toBe(false);
    expect(isConcreteSchema({ ...closed, properties: { payload: {} } })).toBe(false);
    expect(isConcreteSchema({ ...closed, patternProperties: { '.*': {} } })).toBe(false);
    for (const body of [{ type: 'object' }, { type: 'object', properties: {} }, { ...closed, additionalProperties: true }]) {
      expect(isConcreteSchema(body)).toBe(false);
    }
    expect(inspectContractCoverage(specification({
      'x-supauth-contract': validatedContract,
      requestBody: { required: false, ...jsonContent(nullable) },
    })).issues).toEqual([]);
    expect(inspectContractCoverage(specification(responseOperation(nullable))).issues).toEqual([]);
    expect(inspectContractCoverage(specification({
      'x-supauth-contract': validatedContract,
      requestBody: jsonContent(closed),
      parameters: [{ in: 'query', name: 'opaque', schema: {} }],
    })).issues).toContainEqual({ operation: 'GET /v1/roles', code: 'missing_request_schema' });
  });

  test.each([
    { type: 'object', properties: { payload: {} }, required: ['payload'] },
    { type: 'object', properties: { nested: { type: 'object', properties: { payload: {} } } } },
    { type: 'object', properties: { payload: { $ref: '#/components/schemas/Missing' } } },
    { type: 'object', properties: { rows: { type: 'array', items: {} } } },
    { type: 'object', properties: { value: { anyOf: [{ type: 'string' }, {}] } } },
    { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: {} },
    { type: 'object', properties: { metadata: { type: 'object', additionalProperties: true } } },
  ])('rejects nested opaque or unresolved fields: %j', schema => {
    expect(isConcreteSchema(schema)).toBe(false);
    expect(inspectContractCoverage(specification(responseOperation(schema))).issues)
      .toContainEqual({ operation: 'GET /v1/roles', code: 'missing_response_schema' });
  });

  test('accepts structured self recursion and shared references independent of property order', () => {
    for (const properties of [
      { id: { type: 'string' }, children: { type: 'array', items: { $ref: '#/components/schemas/Node' } } },
      { children: { type: 'array', items: { $ref: '#/components/schemas/Node' } }, id: { type: 'string' } },
    ]) {
      const document = { components: { schemas: { Node: { type: 'object', properties } } } };
      const reference = { $ref: '#/components/schemas/Node' };
      expect(isConcreteSchema(reference, document)).toBe(true);
      expect(isConcreteSchema({ type: 'object', properties: { first: reference, second: reference } }, document)).toBe(true);
    }
  });

  test('accepts mutually recursive structured nodes but not aliases or unanchored cycles', () => {
    const document = {
      components: { schemas: {
        A: { type: 'object', properties: { value: { type: 'string' }, next: { $ref: '#/components/schemas/B' } } },
        B: { type: 'object', properties: { previous: { $ref: '#/components/schemas/A' } } },
        AliasA: { $ref: '#/components/schemas/AliasB' },
        AliasB: { $ref: '#/components/schemas/AliasA' },
        Unanchored: { type: 'object', properties: { next: { $ref: '#/components/schemas/Unanchored' } } },
      } },
    };
    for (const name of ['A', 'B']) expect(isConcreteSchema({ $ref: `#/components/schemas/${name}` }, document)).toBe(true);
    for (const name of ['AliasA', 'AliasB', 'Unanchored']) {
      expect(isConcreteSchema({ $ref: `#/components/schemas/${name}` }, document)).toBe(false);
    }
  });

  test('permits typed JSON metadata within a domain, not generic JSON as the root domain', () => {
    const reference = { $ref: '#/components/schemas/JsonValue' };
    const dictionary = { type: 'object', patternProperties: { '^(.*)$': reference } };
    const document = { components: { schemas: {
      JsonValue: { anyOf: [
        { type: 'null' }, { type: 'boolean' }, { type: 'number' }, { type: 'string' },
        { type: 'array', items: reference }, dictionary,
      ] },
    } } };
    expect(isConcreteSchema(reference, document)).toBe(false);
    expect(isConcreteSchema(dictionary, document)).toBe(false);
    expect(isConcreteSchema({ type: 'array', items: dictionary }, document)).toBe(false);
    expect(isConcreteSchema({ type: 'object', properties: { id: { type: 'string' }, metadata: dictionary } }, document)).toBe(true);
    expect(isConcreteSchema({ type: 'object', properties: { metadata: dictionary } }, document)).toBe(true);
    expect(isConcreteSchema({
      type: 'object', properties: { id: { type: 'string' } },
      additionalProperties: { $ref: '#/components/schemas/JsonValue' },
    }, document)).toBe(true);
  });

  test('checks reference siblings and refuses uncanonicalized raw TypeBox ids', () => {
    const document = { components: { schemas: { Role: entity } } };
    expect(isConcreteSchema({
      $ref: '#/components/schemas/Role',
      type: 'object', properties: { payload: {} },
    }, document)).toBe(false);
    expect(isConcreteSchema({
      type: 'object',
      properties: { metadata: { $id: 'JsonValue', anyOf: [{ type: 'string' }, { type: 'array', items: { $ref: 'JsonValue' } }] } },
    })).toBe(false);
  });

  test('resolves escaped local pointers without trusting inherited object keys', () => {
    expect(isConcreteSchema({ $ref: '#/components/schemas/A~1B~0C' }, {
      components: { schemas: { 'A/B~C': entity } },
    })).toBe(true);
    expect(isConcreteSchema({ $ref: '#/components/schemas/Inherited' }, {
      components: { schemas: Object.create({ Inherited: entity }) },
    })).toBe(false);
  });

  test('checks all composition and tuple members instead of accepting a single typed branch', () => {
    expect(isConcreteSchema({ allOf: [entity, { type: 'object', properties: { name: { type: 'string' } } }] })).toBe(true);
    expect(isConcreteSchema({ allOf: [entity, {}] })).toBe(false);
    expect(isConcreteSchema({ type: 'array', items: [{ type: 'string' }, entity], additionalItems: false })).toBe(true);
    expect(isConcreteSchema({ type: 'array', items: [{ type: 'string' }, {}] })).toBe(false);
  });
});

describe('real hidden route evidence (F3)', () => {
  test('validated labels without operations or schemas cannot count as covered', () => {
    for (const operation of [undefined, {}, { responses: { '200': jsonContent({}) } }]) {
      const result = inspectContractCoverage(specification(), [{
        method: 'POST', path: '/hidden', hidden: true, contract: validatedContract,
        ...(operation === undefined ? {} : { operation }),
      }]);
      expect(result.total).toBe(2);
      expect(result.hidden).toBe(1);
      expect(result.covered).toBe(1);
      expect(result.issues).toContainEqual({ operation: 'POST /hidden', code: 'missing_request_schema' });
      expect(result.issues).toContainEqual({ operation: 'POST /hidden', code: 'missing_response_schema' });
    }
  });

  test('keeps real detail and raw bindings without inventing protocol declarations', () => {
    const body = { type: 'object', properties: { name: { type: 'string' } } };
    const hooks = {
      detail: {
        hide: true, 'x-supauth-contract': validatedContract,
        requestBody: jsonContent(body), responses: { '201': jsonContent(entity) },
      },
      body,
      response: { '201': entity },
    };
    const route = createRouteContractInventory({ method: 'POST', path: '/hidden', hooks });
    expect(route.operation).toEqual({ ...hooks.detail, 'x-supauth-bindings': { body, response: hooks.response } });
    expect(route.contract).toBe(validatedContract);
    expect(inspectContractCoverage(specification(), [structuredClone(route)])).toEqual({
      total: 2, hidden: 1, covered: 2, issues: [],
    });
    expect(createRouteContractInventory({ method: 'GET', path: '/untyped' }).operation).toEqual({});
  });

  test('uses actual bound schemas even without OpenAPI detail schema fields', () => {
    const route = createRouteContractInventory({
      method: 'POST', path: '/hidden/:id',
      hooks: {
        detail: { hide: true, 'x-supauth-contract': validatedContract },
        body: entity,
        params: { type: 'object', properties: { id: { type: 'string' } } },
        query: { type: 'object', properties: { limit: { type: 'integer' } } },
        response: entity,
      },
    });
    expect(inspectContractCoverage(specification(), [route]).issues).toEqual([]);
  });

  test('a valid document cannot mask empty runtime bindings', () => {
    const route = createRouteContractInventory({
      method: 'GET', path: '/v1/roles',
      hooks: {
        detail: { ...responseOperation(entity), 'x-supauth-contract': validatedContract },
        body: {},
        response: { '200': {} },
      },
    });
    const result = inspectContractCoverage(specification(), [route]);
    expect(result.covered).toBe(0);
    expect(result.issues).toContainEqual({ operation: 'GET /v1/roles', code: 'missing_request_schema' });
    expect(result.issues).toContainEqual({ operation: 'GET /v1/roles', code: 'missing_response_schema' });
  });

  test('does not replace missing public operations with inventory detail', () => {
    const route = createRouteContractInventory({
      method: 'GET', path: '/public-missing',
      hooks: { detail: responseOperation(entity) },
    });
    expect(inspectContractCoverage(specification(), [route]).issues)
      .toContainEqual({ operation: 'GET /public-missing', code: 'missing_operation' });
  });
});

describe('independent request and response regions (F4)', () => {
  test('allows explicit bodyless statuses alongside concrete JSON without accepting arbitrary empty responses', () => {
    for (const status of ['204', '205', '304']) {
      expect(inspectContractCoverage(specification({
        responses: { '200': jsonContent(entity), [status]: { description: 'No content' } },
      })).issues).toEqual([]);
      expect(inspectContractCoverage(specification({
        responses: { '200': jsonContent(entity), [status]: jsonContent(entity) },
      })).issues).toContainEqual({ operation: 'GET /v1/roles', code: 'missing_response_schema' });
    }
    for (const response of [{}, { description: 'empty' }, { content: {} }, jsonContent({})]) {
      expect(inspectContractCoverage(specification({
        responses: { '200': response, '204': { description: 'No content' } },
      })).issues).toContainEqual({ operation: 'GET /v1/roles', code: 'missing_response_schema' });
    }
    expect(inspectContractCoverage(specification({
      responses: { '204': { $ref: '#/components/responses/Missing' } },
    })).issues).toContainEqual({ operation: 'GET /v1/roles', code: 'missing_response_schema' });
  });

  test('checks declared redirect JSON bodies instead of requiring a fabricated 200 response', () => {
    const response = jsonContent({ type: 'object', properties: { redirect: { type: 'string', minLength: 1 } } });
    expect(inspectContractCoverage(specification({ responses: { '302': response } })).issues).toEqual([]);
    expect(inspectContractCoverage(specification(), [{
      method: 'GET', path: '/hidden-redirect', hidden: true,
      contract: { request: 'none', response: 'validated', source: 'fixture.redirect' },
      operation: { 'x-supauth-bindings': { response: { '302': entity } } },
    }]).issues).toEqual([]);
    for (const opaque of [{}, jsonContent({}), jsonContent({ $ref: '#/components/schemas/Missing' })]) {
      expect(inspectContractCoverage(specification({ responses: { '302': opaque } })).issues)
        .toContainEqual({ operation: 'GET /v1/roles', code: 'missing_response_schema' });
      expect(inspectContractCoverage(specification({ responses: { '200': response, '302': opaque } })).issues)
        .toContainEqual({ operation: 'GET /v1/roles', code: 'missing_response_schema' });
    }
  });

  test.each([
    { requestBody: jsonContent({}), parameters: [{ in: 'query', name: 'limit', schema: { type: 'integer' } }] },
    { requestBody: jsonContent(entity), parameters: [{ in: 'query', name: 'limit', schema: {} }] },
    { requestBody: jsonContent(entity), parameters: [{ in: 'query', name: 'limit', schema: { $ref: '#/missing' } }] },
    { requestBody: jsonContent(entity), parameters: {} },
    { requestBody: {}, parameters: [{ in: 'query', name: 'limit', schema: { type: 'integer' } }] },
  ])('rejects each missing or opaque input region independently: %j', inputs => {
    const result = inspectContractCoverage(specification({ 'x-supauth-contract': validatedContract, ...inputs }));
    expect(result.covered).toBe(0);
    expect(result.issues).toContainEqual({ operation: 'GET /v1/roles', code: 'missing_request_schema' });
  });

  test('requires every parameter while allowing genuinely body-only and parameter-only requests', () => {
    const parameter = { in: 'query', name: 'limit', schema: { type: 'integer' } };
    for (const inputs of [
      { requestBody: jsonContent(entity) },
      { parameters: [parameter] },
      { requestBody: jsonContent(entity), parameters: [parameter] },
    ]) expect(inspectContractCoverage(specification({ 'x-supauth-contract': validatedContract, ...inputs })).issues).toEqual([]);
    expect(inspectContractCoverage(specification({
      'x-supauth-contract': validatedContract,
      parameters: [parameter, { in: 'header', name: 'x-mode', schema: {} }],
    })).covered).toBe(0);
  });

  test('checks inherited path parameters and operation-level overrides', () => {
    const schema = (pathSchema: unknown, override = false) => ({ paths: {
      '/roles/{id}': {
        parameters: [{ in: 'path', name: 'id', required: true, schema: pathSchema }],
        post: {
          ...responseOperation(entity),
          'x-supauth-contract': validatedContract,
          requestBody: jsonContent(entity),
          ...(override ? { parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }] } : {}),
        },
      },
    } });
    expect(inspectContractCoverage(schema({})).covered).toBe(0);
    expect(inspectContractCoverage(schema({ type: 'string' })).covered).toBe(1);
    expect(inspectContractCoverage(schema({}, true)).covered).toBe(1);
    expect(inspectContractCoverage({ paths: { '/roles/{id}': { post: {
      ...responseOperation(entity), 'x-supauth-contract': validatedContract, requestBody: jsonContent(entity),
    } } } }).issues).toContainEqual({ operation: 'POST /roles/{id}', code: 'missing_request_schema' });
  });

  test('resolves real request, response and parameter references', () => {
    const document = specification({
      'x-supauth-contract': validatedContract,
      requestBody: { $ref: '#/components/requestBodies/Create' },
      parameters: [{ $ref: '#/components/parameters/Limit' }],
      responses: { '200': { $ref: '#/components/responses/Role' } },
    });
    Object.assign(document, { components: {
      requestBodies: { Create: jsonContent(entity) },
      parameters: { Limit: { in: 'query', name: 'limit', schema: { type: 'integer' } } },
      responses: { Role: jsonContent(entity) },
    } });
    expect(inspectContractCoverage(document).covered).toBe(1);
  });

  test('does not let one media type or wildcard success hide an opaque schema', () => {
    const mixed = { content: { 'application/json': { schema: {} }, 'text/plain': { schema: { type: 'string' } } } };
    expect(inspectContractCoverage(specification({ responses: { '200': mixed } })).covered).toBe(0);
    expect(inspectContractCoverage(specification({
      'x-supauth-contract': validatedContract, requestBody: mixed,
    })).covered).toBe(0);
    expect(inspectContractCoverage(specification({
      responses: { '200': jsonContent(entity), '2XX': jsonContent({}) },
    })).covered).toBe(0);
  });
});

describe('ALL inventory denominator', () => {
  test('expands ALL and keeps unclassified methods in the denominator', () => {
    const result = inspectContractCoverage(specification(), [{ method: 'ALL', path: '/hidden', hidden: true }]);
    expect(result.total).toBe(9);
    expect(result.hidden).toBe(8);
    expect(result.covered).toBe(1);
    expect(result.issues).toHaveLength(8);
    expect(result.issues).toContainEqual({ operation: 'TRACE /hidden', code: 'missing_contract' });
  });

  test('explicit methods override ALL independent of inventory order', () => {
    const all = {
      method: 'ALL', path: '/hidden', hidden: true,
      contract: { request: 'protocol', response: 'html', source: 'fixture.protocol' },
    };
    const get = { method: 'GET', path: '/hidden', hidden: true, contract: validatedContract };
    for (const inventory of [[all, get], [get, all]]) {
      const result = inspectContractCoverage(specification(), inventory);
      expect(result.total).toBe(9);
      expect(result.covered).toBe(8);
      expect(result.issues).toContainEqual({ operation: 'GET /hidden', code: 'missing_response_schema' });
    }
  });

  test('retains unknown methods as explicit errors instead of silently reducing the denominator', () => {
    const result = inspectContractCoverage(specification(), [{
      method: 'PROPFIND', path: '/custom', hidden: true,
      contract: { request: 'protocol', response: 'protocol', source: 'fixture.protocol' },
    }]);
    expect(result.total).toBe(2);
    expect(result.covered).toBe(1);
    expect(result.issues).toContainEqual({ operation: 'PROPFIND /custom', code: 'unsupported_method' });
  });
});
