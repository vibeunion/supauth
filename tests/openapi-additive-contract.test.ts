import { requireArray, requireRecord } from "../scripts/tooling-values.js";
import { parseJson } from "../scripts/tooling-values.js";
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseOpenApiDocument } from '../scripts/openapi-document-corrections.js';
import { requireRecordArray } from '../scripts/tooling-values.js';
import {
  findOpenApiBreakingChanges,
  type OpenApiDocument,
  type OpenApiObject,
} from '../scripts/openapi-additive-contract.js';

const baseline = parseOpenApiDocument(
  readFileSync('tests/fixtures/openapi-gotrue-only-baseline.json', 'utf8'),
);

function currentSpec(): OpenApiDocument {
  return structuredClone(baseline);
}

function paths(specification: OpenApiDocument): OpenApiObject {
  return requireRecord(specification.paths);
}

function operation(specification: OpenApiDocument, path: string, method: string): OpenApiObject {
  return requireRecord((requireRecord(paths(specification)[path]))[method]);
}

function applicationGrantSchema(specification: OpenApiDocument): OpenApiObject {
  const requestBody = requireRecord(operation(specification, '/v1/applications/', 'post')["requestBody"]);
  const content = requireRecord(requestBody["content"]);
  const mediaType = requireRecord(content['application/json']);
  const schema = requireRecord(mediaType["schema"]);
  return requireRecord((requireRecord(schema["properties"]))["grant_types"]);
}

function schemaSpec(schema: OpenApiObject): OpenApiDocument {
  return {
    openapi: '3.0.3',
    paths: {
      '/probe/{id}': {
        post: {
          operationId: 'probe',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema } } },
          responses: { 200: {} },
        },
      },
    },
  };
}

function compareSchemas(before: OpenApiObject, after: OpenApiObject): string[] {
  return findOpenApiBreakingChanges(schemaSpec(before), schemaSpec(after));
}

describe('GoTrue-only OpenAPI additive contract', () => {
  test('keeps legacy metadata sync routes outside the supported baseline', () => {
    expect(paths(baseline)['/v1/sync/user/{userId}']).toBeUndefined();
    expect(paths(baseline)['/v1/sync/org/{orgId}']).toBeUndefined();
  });

  test('accepts the checked-in baseline and additive paths, methods, and schemas', () => {
    const current = currentSpec();
    paths(current)['/v1/additive-probe'] = {
      get: { operationId: 'getV1AdditiveProbe', responses: { 200: {} } },
    };
    (requireRecord(paths(current)['/v1/health']))["options"] = {
      operationId: 'optionsV1Health',
      responses: { 204: {} },
    };
    const schemas = requireRecord(((current.components ||= {})["schemas"] ||= {}));
    schemas["AdditiveProbe"] = { type: 'object', properties: { id: { type: 'string' } } };

    expect(findOpenApiBreakingChanges(baseline, current)).toEqual([]);
  });

  test('rejects a removed path', () => {
    const current = currentSpec();
    delete paths(current)['/v1/health'];

    expect(findOpenApiBreakingChanges(baseline, current)).toContain('Path removed: /v1/health');
  });

  test('rejects a removed method', () => {
    const current = currentSpec();
    delete (requireRecord(paths(current)['/v1/applications/']))["post"];

    expect(findOpenApiBreakingChanges(baseline, current)).toContain('Operation removed: POST /v1/applications/');
  });

  test('rejects a removed operation schema', () => {
    const current = currentSpec();
    delete applicationGrantSchema(current)["items"];

    expect(findOpenApiBreakingChanges(baseline, current)).toContain(
      'POST /v1/applications/ requestBody.content.application/json.schema.properties.grant_types.items was removed',
    );
  });

  test('rejects an incompatible grant type schema', () => {
    const current = currentSpec();
    applicationGrantSchema(current)["minItems"] = 2;

    expect(findOpenApiBreakingChanges(baseline, current)).toContain(
      'POST /v1/applications/ requestBody.content.application/json.schema.properties.grant_types.minItems changed from 1 to 2',
    );
  });
});

describe('schema-aware OpenAPI comparisons', () => {
  test.each(['type', 'required', 'enum', 'allOf', 'schema', 'properties'])(
    'accepts an additive optional business property named %s',
    (name) => {
      expect(compareSchemas(
        { type: 'object', properties: {} },
        { type: 'object', properties: { [name]: { type: 'string' } } },
      )).toEqual([]);
    },
  );

  test('still rejects actual type and required restrictions on keyword-named properties', () => {
    expect(compareSchemas(
      { type: 'object', properties: { type: { type: 'string' } } },
      { type: 'object', properties: { type: { type: 'number' } } },
    )).toContain(
      'POST /probe/{id} requestBody.content.application/json.schema.properties.type.type changed from "string" to "number"',
    );
    expect(compareSchemas(
      { type: 'object', properties: { type: { type: 'string' } } },
      { type: 'object', properties: { type: { type: 'string' } }, required: ['type'] },
    )).toContain('POST /probe/{id} requestBody.content.application/json.schema.required added a new restriction');
  });

  test.each(['description', 'summary', 'x-client'])('does not ignore a removed business property named %s', name => {
    expect(compareSchemas(
      { type: 'object', properties: { [name]: { type: 'string' } } },
      { type: 'object', properties: {} },
    )).toContain(`POST /probe/{id} requestBody.content.application/json.schema.properties.${name} was removed`);
  });

  test('keeps ordinary Schema descriptions non-contractual', () => {
    expect(compareSchemas(
      { type: 'string', description: 'before' },
      { type: 'string', description: 'after' },
    )).toEqual([]);
  });

  test.each(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'])(
    'checks schema children in %s without confusing child names with keywords',
    key => {
      expect(compareSchemas(
        { [key]: { type: { type: 'string' } } },
        { [key]: { type: { type: 'string', minLength: 1 } } },
      )).toContain(`POST /probe/{id} requestBody.content.application/json.schema.${key}.type.minLength added a new restriction`);
    },
  );

  test('checks component schemas, parameter schemas, and nested response item schemas', () => {
    const before = schemaSpec({});
    before.components = { schemas: { type: { type: 'string' } } };
    operation(before, '/probe/{id}', 'post')["responses"] = {
      200: { content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } },
    };
    const after = structuredClone(before);
    after.components = { schemas: { type: { type: 'string', minLength: 1 } } };
    operation(after, '/probe/{id}', 'post')["parameters"] = [
      { name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-z]+$' } },
    ];
    operation(after, '/probe/{id}', 'post')["responses"] = {
      200: { content: { 'application/json': { schema: { type: 'array', items: { type: 'string', minLength: 1 } } } } },
    };
    const changes = findOpenApiBreakingChanges(before, after);
    expect(changes).toContain('components.schemas.type.minLength added a new restriction');
    expect(changes).toContain('POST /probe/{id} parameter path:id.schema.pattern added a new restriction');
    expect(changes).toContain('POST /probe/{id} responses.200.content.application/json.schema.items.minLength added a new restriction');
  });
});

describe('new reference and additional-property constraints', () => {
  test.each([
    { additionalProperties: { type: 'string' } },
    { additionalProperties: { allOf: [{ type: 'string' }, { minLength: 1 }] } },
    { additionalProperties: { $ref: '#/components/schemas/Restricted' } },
    { additionalProperties: false },
    { $ref: '#/components/schemas/Restricted' },
  ])('reports newly declared constraints: %j', restriction => {
    const before = schemaSpec({ type: 'object' });
    before.components = { schemas: { Restricted: { type: 'string' } } };
    const after = schemaSpec({ type: 'object', ...restriction });
    after.components = structuredClone(before.components);
    expect(findOpenApiBreakingChanges(before, after).some(change =>
      change.includes(`schema.${Object.keys(restriction)[0]} added a new restriction`),
    )).toBe(true);
  });

  test('reports new references on unconstrained schema, nested items, and existing parameter/response schemas', () => {
    const ref = { $ref: '#/components/schemas/Restricted' };
    expect(compareSchemas({}, ref)).toContain(
      'POST /probe/{id} requestBody.content.application/json.schema.$ref added a new restriction',
    );
    expect(compareSchemas({ type: 'array', items: {} }, { type: 'array', items: ref })).toContain(
      'POST /probe/{id} requestBody.content.application/json.schema.items.$ref added a new restriction',
    );
    const before = schemaSpec({});
    before.components = { schemas: { Restricted: { type: 'string' } } };
    operation(before, '/probe/{id}', 'post')["responses"] = {
      200: { content: { 'application/json': { schema: {} } } },
    };
    const after = structuredClone(before);
    operation(after, '/probe/{id}', 'post')["parameters"] = [
      { name: 'id', in: 'path', required: true, schema: { type: 'string', ...ref } },
    ];
    operation(after, '/probe/{id}', 'post')["responses"] = {
      200: { content: { 'application/json': { schema: ref } } },
    };
    const changes = findOpenApiBreakingChanges(before, after);
    expect(changes).toContain('POST /probe/{id} parameter path:id.schema.$ref added a new restriction');
    expect(changes).toContain('POST /probe/{id} responses.200.content.application/json.schema.$ref added a new restriction');
  });

  test('accepts explicit unrestricted additional properties and unchanged references', () => {
    expect(compareSchemas({ type: 'object' }, { type: 'object', additionalProperties: true })).toEqual([]);
    const schema = { $ref: '#/components/schemas/Restricted', additionalProperties: { type: 'string' } };
    expect(compareSchemas(schema, structuredClone(schema))).toEqual([]);
  });

  test.each(['$ref', 'additionalProperties'])('does not treat a new optional property named %s as a keyword', name => {
    expect(compareSchemas(
      { type: 'object', properties: {} },
      { type: 'object', properties: { [name]: { type: 'string' } } },
    )).toEqual([]);
  });

  test('does not equate an unknown additional-properties shape with an unrestricted object', () => {
    expect(compareSchemas({}, { additionalProperties: { 'unknown-validation-keyword': true } }))
      .toContain('POST /probe/{id} requestBody.content.application/json.schema.additionalProperties added a new restriction');
  });
});

describe('local OpenAPI references retain required contracts', () => {
  function document(): OpenApiDocument {
    return {
      openapi: '3.0.3', info: { title: 'Reference probe', version: '1' },
      paths: { '/probe': { post: { operationId: 'probe', responses: { 200: { description: 'Success' } } } } },
    };
  }
  const body = { content: { 'application/json': { schema: { type: 'string' } } } };
  const header = { name: 'proof', in: 'header', schema: { type: 'string' } };

  function withBody(required: boolean): OpenApiDocument {
    const result = document();
    result.components = { requestBodies: { NewRequiredBody: { ...body, required } } };
    operation(result, '/probe', 'post')["requestBody"] = { $ref: '#/components/requestBodies/NewRequiredBody' };
    return result;
  }
  function withHeader(required: boolean): OpenApiDocument {
    const result = document();
    result.components = { parameters: { NewRequiredHeader: { ...header, required } } };
    operation(result, '/probe', 'post')["parameters"] = [{ $ref: '#/components/parameters/NewRequiredHeader' }];
    return result;
  }

  test('detects new required referenced bodies and headers', () => {
    expect(findOpenApiBreakingChanges(document(), withBody(true))).toContain('POST /probe added a required request body');
    expect(findOpenApiBreakingChanges(document(), withHeader(true))).toContain('POST /probe added required parameter header:proof');
    expect(findOpenApiBreakingChanges(document(), withBody(false))).toEqual([]);
    expect(findOpenApiBreakingChanges(document(), withHeader(false))).toEqual([]);
  });

  test('detects optional-to-required changes through stable references', () => {
    expect(findOpenApiBreakingChanges(withBody(false), withBody(true)))
      .toContain('POST /probe made its request body required');
    expect(findOpenApiBreakingChanges(withHeader(false), withHeader(true)))
      .toContain('POST /probe made parameter header:proof required');
  });

  test('resolves chains, escaped pointers and referenced path-level parameters', () => {
    const current = document();
    current.components = {
      requestBodies: { 'a/b~c': { ...body, required: true }, Alias: { $ref: '#/components/requestBodies/a~1b~0c' } },
      parameters: { Proof: { ...header, required: true } },
    };
    operation(current, '/probe', 'post')["requestBody"] = { $ref: '#/components/requestBodies/%41lias' };
    (requireRecord(paths(current)['/probe']))["parameters"] = [{ $ref: '#/components/parameters/Proof' }];
    const changes = findOpenApiBreakingChanges(document(), current);
    expect(changes).toContain('POST /probe added a required request body');
    expect(changes).toContain('POST /probe added required parameter header:proof');
  });

  test('resolves a Path Item reference before comparing its inherited parameters', async () => {
    const { validateOpenApiDocument } = await import('../scripts/openapi-validation.js');
    const current = document();
    const target = requireRecord(paths(current)['/probe']);
    target["parameters"] = [{ $ref: '#/components/parameters/Proof' }];
    current.paths = { '/probe': { $ref: '#/paths/~1template' }, '/template': target };
    current.components = { parameters: { Proof: { ...header, required: true } } };
    await validateOpenApiDocument(current);
    expect(findOpenApiBreakingChanges(document(), current))
      .toContain('POST /probe added required parameter header:proof');
    current.components = { parameters: { Proof: { ...header, required: false } } };
    expect(findOpenApiBreakingChanges(document(), current)).toEqual([]);
  });

  function parameterOverrideSpec(required: boolean, referenced: boolean): OpenApiDocument {
    const result = document();
    const pathProof = { ...header, required: false };
    const operationProof = { ...header, required };
    const endpoint = operation(result, '/probe', 'post');
    endpoint["parameters"] = [referenced ? { $ref: '#/components/parameters/OperationProof' } : operationProof];
    result.paths = { '/probe/{id}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        referenced ? { $ref: '#/components/parameters/PathProof' } : pathProof,
        { name: 'proof', in: 'query', required: false, schema: { type: 'string' } },
      ],
      post: endpoint,
    } };
    if (referenced) result.components = { parameters: { PathProof: pathProof, OperationProof: operationProof } };
    return result;
  }

  test.each([false, true])('is reflexive when an operation overrides a path parameter (refs=%s)', async referenced => {
    const { validateOpenApiDocument } = await import('../scripts/openapi-validation.js');
    const current = parameterOverrideSpec(true, referenced);
    await validateOpenApiDocument(current);
    expect(findOpenApiBreakingChanges(current, structuredClone(current))).toEqual([]);
  });

  test.each([false, true])('still detects optional-to-required effective parameters (refs=%s)', referenced => {
    expect(findOpenApiBreakingChanges(
      parameterOverrideSpec(false, referenced), parameterOverrideSpec(true, referenced),
    )).toContain('POST /probe/{id} made parameter header:proof required');
  });

  test.each([false, true])('preserves unrelated path parameters and the same name in another location (refs=%s)', referenced => {
    const before = parameterOverrideSpec(true, referenced);
    const after = structuredClone(before);
    const pathItem = requireRecord(paths(after)['/probe/{id}']);
    const parameters = requireRecordArray(pathItem['parameters']);
    parameters[0] = { name: 'id', in: 'path', required: true, schema: { type: 'string', minLength: 1 } };
    parameters[2] = { name: 'proof', in: 'query', required: true, schema: { type: 'string' } };
    const changes = findOpenApiBreakingChanges(before, after);
    expect(changes).toContain('POST /probe/{id} parameter path:id.schema.minLength added a new restriction');
    expect(changes).toContain('POST /probe/{id} made parameter query:proof required');
    expect(changes).not.toContain('POST /probe/{id} made parameter header:proof required');
    pathItem["parameters"] = parameters.slice(1);
    expect(findOpenApiBreakingChanges(before, after)).toContain('POST /probe/{id} removed parameter path:id');
  });

  test('accepts equivalent inline-to-reference representation without mutating documents', () => {
    const before = document();
    operation(before, '/probe', 'post')["requestBody"] = { ...body, required: false };
    operation(before, '/probe', 'post')["parameters"] = [{ ...header, required: false }];
    const after = withBody(false);
    Object.assign(after.components ?? {}, { parameters: { Proof: { ...header, required: false } } });
    operation(after, '/probe', 'post')["parameters"] = [{ $ref: '#/components/parameters/Proof' }];
    const snapshot = structuredClone({ before, after });
    expect(findOpenApiBreakingChanges(before, after)).toEqual([]);
    expect({ before, after }).toEqual(snapshot);
  });

  test.each([
    '#/components/requestBodies/Missing', 'file:///__never_read__/body.json',
    'https://example.invalid/body.json', '#/components/requestBodies/A~2',
    '#/components/requestBodies/%ZZ', '#/components/requestBodies/__proto__',
  ])('reports dangling, external or malformed pointers: %s', ref => {
    const current = document();
    current.components = { requestBodies: {} };
    operation(current, '/probe', 'post')["requestBody"] = { $ref: ref };
    expect(findOpenApiBreakingChanges(document(), current).some(change => change.includes('reference'))).toBe(true);
  });

  test('reports circular chains and structurally invalid target kinds', () => {
    const current = withBody(false);
    current.components = { requestBodies: {
      NewRequiredBody: { $ref: '#/components/requestBodies/Other' },
      Other: { $ref: '#/components/requestBodies/NewRequiredBody' },
    } };
    expect(findOpenApiBreakingChanges(document(), current)).toContain('POST /probe requestBody has an invalid or cyclic requestBody reference');
    current.components = { requestBodies: { NewRequiredBody: { required: true } } };
    expect(findOpenApiBreakingChanges(document(), current)).toContain('POST /probe requestBody has an invalid requestBody reference target');
    const invalidHeader = withHeader(false);
    invalidHeader.components = { parameters: { NewRequiredHeader: { required: true } } };
    expect(findOpenApiBreakingChanges(document(), invalidHeader)).toContain('POST /probe parameter has an invalid parameter reference target');
  });

  test('preserves Schema references and genuine recursive Schema semantics', () => {
    const before = withBody(false);
    before.components = {
      requestBodies: { NewRequiredBody: { required: false, content: {
        'application/json': { schema: { $ref: '#/components/schemas/Node' } },
      } } },
      schemas: { Node: { type: 'object', properties: { next: { $ref: '#/components/schemas/Node' } } } },
    };
    expect(findOpenApiBreakingChanges(before, structuredClone(before))).toEqual([]);
    const after = structuredClone(before);
    const bodies = requireRecord(after.components?.["requestBodies"]);
    bodies["NewRequiredBody"] = { required: false, content: {
      'application/json': { schema: { $ref: '#/components/schemas/Other' } },
    } };
    const schemas = requireRecord(after.components?.["schemas"]);
    schemas["Other"] = { type: 'string' };
    expect(findOpenApiBreakingChanges(before, after).some(change =>
      change.includes('requestBody.content.application/json.schema.$ref changed'),
    )).toBe(true);
  });

  test.each(['body', 'header'])('an empty ledger cannot swallow a new referenced required %s', async kind => {
    const { inspectReviewedOpenApi, sha256 } = await import('../scripts/openapi-document-corrections.js');
    const { validateOpenApiDocument } = await import('../scripts/openapi-validation.js');
    const legacy = document();
    const current = kind === 'body' ? withBody(true) : withHeader(true);
    await validateOpenApiDocument(legacy);
    await validateOpenApiDocument(current);
    const source = JSON.stringify(legacy);
    const result = await inspectReviewedOpenApi(source, source, JSON.stringify({
      version: 1, legacySha256: sha256(source), reviewedSha256: sha256(source),
      runtimeCommit: '7e753ed0b0dee57d39e19157b926cdd85c0ebc3f', corrections: [],
    }), current);
    const expected = kind === 'body' ? 'POST /probe added a required request body' : 'POST /probe added required parameter header:proof';
    expect(result.rawChanges).toContain(expected);
    expect(result.residualChanges).toContain(expected);
    expect(result.reviewedChanges).toContain(expected);
  });
});

describe('finite same-value enum normalization', () => {
  test.each([
    { type: 'string', values: ['a', 'b'] },
    { type: 'integer', values: [1, 2] },
    { type: 'number', values: [1.5, 2.5] },
    { type: 'boolean', values: [false, true] },
    { type: 'null', values: [null] },
  ])('accepts only the same literal values for $type in either direction', ({ type, values }) => {
    const enumeration = { type, enum: values };
    const alternatives = { anyOf: [...values].reverse().map(value => ({ type, const: value })) };
    expect(compareSchemas(enumeration, alternatives)).toEqual([]);
    expect(compareSchemas(alternatives, enumeration)).toEqual([]);
  });

  test('accepts identical anyOf duplicates and non-validation annotations', () => {
    expect(compareSchemas(
      { type: 'string', enum: ['a'], description: 'old' },
      { anyOf: [{ type: 'string', const: 'a', title: 'A' }, { const: 'a' }], description: 'new' },
    )).toEqual([]);
  });

  test.each([
    { values: ['a'] }, { values: ['a', 'b', 'c'] }, { values: ['a', 1] },
  ])('rejects a different accepted value set %j', ({ values }) => {
    expect(compareSchemas(
      { type: 'string', enum: ['a', 'b'] },
      { anyOf: values.map(value => ({ const: value })) },
    ).length).toBeGreaterThan(0);
  });

  test.each([
    { anyOf: [{ type: 'string', const: 'a', minLength: 2 }] },
    { anyOf: [{ type: 'string', const: 'a' }], minLength: 2 },
    { anyOf: [{ type: 'number', const: 'a' }] },
    { anyOf: [{ $ref: '#/components/schemas/A' }] },
    { anyOf: [{ type: 'string', const: 'a', unknownConstraint: true }] },
    { oneOf: [{ type: 'string', const: 'a' }] },
  ])('preserves conservative reporting for constrained or unknown alternatives %j', alternatives => {
    expect(compareSchemas({ type: 'string', enum: ['a'] }, alternatives).length).toBeGreaterThan(0);
  });

  test('does not treat a broad string becoming finite literals as equivalent', () => {
    expect(compareSchemas(
      { type: 'string' },
      { anyOf: [{ type: 'string', const: 'a' }] },
    ).length).toBeGreaterThan(0);
  });

  test('does not drop constraints on an enum just because its literal values match', () => {
    expect(compareSchemas(
      { type: 'string', enum: ['a'], minLength: 1 },
      { anyOf: [{ type: 'string', const: 'a' }] },
    )).toContain('POST /probe/{id} requestBody.content.application/json.schema.minLength was removed');
  });
});

describe('new composition and root security restrictions', () => {
  test.each(['allOf', 'anyOf', 'oneOf'])('reports newly introduced %s and accepts unchanged composition', key => {
    const restricted = { type: 'string', [key]: [{ type: 'string', minLength: 2 }] };
    expect(compareSchemas({ type: 'string' }, restricted))
      .toContain(`POST /probe/{id} requestBody.content.application/json.schema.${key} added a new restriction`);
    expect(compareSchemas(restricted, structuredClone(restricted))).toEqual([]);
    expect(compareSchemas(
      restricted,
      { type: 'string', [key]: [{ type: 'string', minLength: 3 }] },
    )).toContain(`POST /probe/{id} requestBody.content.application/json.schema.${key}[0].minLength changed from 2 to 3`);
  });

  test('detects new allOf siblings of refs and nested composition schemas', () => {
    expect(compareSchemas(
      { $ref: '#/components/schemas/Entity' },
      { $ref: '#/components/schemas/Entity', allOf: [{ required: ['id'] }] },
    )).toContain('POST /probe/{id} requestBody.content.application/json.schema.allOf added a new restriction');
    expect(compareSchemas(
      { type: 'array', items: { type: 'object' } },
      { type: 'array', items: { type: 'object', allOf: [{ required: ['id'] }] } },
    )).toContain('POST /probe/{id} requestBody.content.application/json.schema.items.allOf added a new restriction');
  });

  test('rejects new root security, preserves equal security and reports scope changes/removal', () => {
    const before = schemaSpec({});
    const secured = structuredClone(before);
    secured["security"] = [{ bearerAuth: [] }];
    expect(findOpenApiBreakingChanges(before, secured)).toContain('security changed incompatibly');
    expect(findOpenApiBreakingChanges(secured, structuredClone(secured))).toEqual([]);
    const scoped = structuredClone(secured);
    scoped["security"] = [{ bearerAuth: ['write'] }];
    expect(findOpenApiBreakingChanges(secured, scoped)).toContain('security changed incompatibly');
    expect(findOpenApiBreakingChanges(secured, before)).toContain('security changed incompatibly');
    expect(findOpenApiBreakingChanges(before, structuredClone(before))).toEqual([]);
  });

  test('continues to reject operation security, required input and real status removals', () => {
    const before = schemaSpec({ type: 'object' });
    const after = structuredClone(before);
    const current = operation(after, '/probe/{id}', 'post');
    current["security"] = [{ bearerAuth: [] }];
    current["requestBody"] = { required: true, content: { 'application/json': { schema: { type: 'object' } } } };
    current["parameters"] = [
      { name: 'id', in: 'path', required: true, schema: { type: 'string', minLength: 1 } },
      { name: 'proof', in: 'header', required: true, schema: { type: 'string' } },
      { name: 'scope', in: 'query', required: true, schema: { type: 'string' } },
    ];
    current["responses"] = { 302: {} };
    const changes = findOpenApiBreakingChanges(before, after);
    expect(changes).toContain('POST /probe/{id} security changed incompatibly');
    expect(changes).toContain('POST /probe/{id} made its request body required');
    expect(changes).toContain('POST /probe/{id} parameter path:id.schema.minLength added a new restriction');
    expect(changes).toContain('POST /probe/{id} added required parameter header:proof');
    expect(changes).toContain('POST /probe/{id} added required parameter query:scope');
    expect(changes).toContain('POST /probe/{id} responses.200 was removed');
  });
});

describe('reviewer regressions: nullable, literal data, and converted literals', () => {
  test('rejects newly nullable response values and accepts unchanged non-null responses', () => {
    const responseSpec = (schema: OpenApiObject) => {
      const spec = schemaSpec({});
      operation(spec, '/probe/{id}', 'post')["responses"] = {
        200: { content: { 'application/json': { schema } } },
      };
      return spec;
    };
    const before = responseSpec({ type: 'string' });
    const after = responseSpec({ type: 'string', nullable: true });
    expect(findOpenApiBreakingChanges(before, after)).toContain(
      'POST /probe/{id} responses.200.content.application/json.schema.nullable added a new restriction',
    );
    expect(findOpenApiBreakingChanges(before, responseSpec({ type: 'string', nullable: false }))).toEqual([]);
    expect(findOpenApiBreakingChanges(after, responseSpec({ type: 'string', nullable: true }))).toEqual([]);
    expect(findOpenApiBreakingChanges(after, responseSpec({ type: 'string', nullable: false })).length).toBeGreaterThan(0);
  });

  test('does not mistake an optional property named nullable for a Schema keyword', () => {
    expect(compareSchemas(
      { type: 'object', properties: {} },
      { type: 'object', properties: { nullable: { type: 'boolean' } } },
    )).toEqual([]);
  });

  test.each(['enum', 'required', 'type', 'allOf'])('compares ordinary default.%s arrays in order', key => {
    expect(compareSchemas(
      { type: 'object', default: { [key]: [1, 2] } },
      { type: 'object', default: { [key]: [2, 1] } },
    )).toContain('POST /probe/{id} requestBody.content.application/json.schema.default changed incompatibly');
    expect(compareSchemas(
      { type: 'object', default: { [key]: [1, 2] } },
      { type: 'object', default: { [key]: [1, 2] } },
    )).toEqual([]);
  });

  test('rejects ordinary default array additions and nested literal const changes', () => {
    expect(compareSchemas(
      { type: 'array', default: [1] },
      { type: 'array', default: [1, 2] },
    )).toContain('POST /probe/{id} requestBody.content.application/json.schema.default changed incompatibly');
    expect(compareSchemas(
      { const: { enum: [1, 2] } },
      { const: { enum: [2, 1] } },
    )).toContain('POST /probe/{id} requestBody.content.application/json.schema.const changed incompatibly');
  });

  test('keeps actual Schema enum, required and type arrays set-based', () => {
    expect(compareSchemas({ enum: [1, 2] }, { enum: [2, 1] })).toEqual([]);
    expect(compareSchemas({ required: ['a', 'b'] }, { required: ['b', 'a'] })).toEqual([]);
    expect(compareSchemas({ type: ['string', 'null'] }, { type: ['null', 'string'] })).toEqual([]);
  });

  test.each([
    { type: 'string', values: ['a', 'b'] },
    { type: 'number', values: [1.5, 2.5] },
    { type: 'boolean', values: [false, true] },
    { type: 'null', values: [null] },
  ])('recognizes same-value converted singleton enum branches for $type', ({ type, values }) => {
    const original = { type, enum: values };
    const converted = { anyOf: [...values].reverse().map(value => ({ type, enum: [value] })) };
    const literals = { anyOf: values.map(value => ({ type, const: value })) };
    expect(compareSchemas(original, converted)).toEqual([]);
    expect(compareSchemas(converted, original)).toEqual([]);
    expect(compareSchemas(literals, converted)).toEqual([]);
  });

  test('recognizes mixed pure const and singleton enum branches with the same domain', () => {
    expect(compareSchemas(
      { type: 'string', enum: ['a', 'b'] },
      { anyOf: [{ type: 'string', const: 'a' }, { type: 'string', enum: ['b'] }] },
    )).toEqual([]);
  });

  test.each([
    { anyOf: [{ type: 'string', enum: ['b'] }] },
    { anyOf: [{ type: 'string', enum: ['a', 'b'] }] },
    { anyOf: [{ type: 'string', enum: [] }] },
    { anyOf: [{ type: 'string', enum: ['a'], minLength: 2 }] },
    { anyOf: [{ type: 'string', enum: ['a'], nullable: true }] },
    { anyOf: [{ type: 'number', enum: ['a'] }] },
    { anyOf: [{ type: 'string', enum: ['a'], const: 'a' }] },
    { anyOf: [{ $ref: '#/components/schemas/A', enum: ['a'] }] },
    { oneOf: [{ type: 'string', enum: ['a'] }] },
  ])('does not normalize changed, constrained, or unknown singleton alternatives %j', converted => {
    expect(compareSchemas({ type: 'string', enum: ['a'] }, converted).length).toBeGreaterThan(0);
  });
});
