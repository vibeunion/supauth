import { requireRecord } from "../scripts/tooling-values.js";
import { isUnknownArray } from "../scripts/tooling-values.js";
import { describe, expect, test } from 'bun:test';
import { convertOpenApi30Schemas, OpenApi30ConversionError } from '../scripts/openapi-30-schema.js';
import { canonicalizeOpenApiReferences } from '../scripts/openapi-schema-references.js';

function document(schema: unknown) {
  return {
    openapi: '3.0.3',
    info: { title: 'converter probe', version: '1' },
    paths: {
      '/probe': {
        get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema } } } } },
      },
    },
  };
}

function outputSchema(schema: unknown) {
  const output = convertOpenApi30Schemas(document(schema)).spec;
  const paths = output["paths"];
  if (!paths || typeof paths !== 'object' || isUnknownArray(paths)) throw new Error('Missing paths');
  const path = paths['/probe'];
  if (!path || typeof path !== 'object' || isUnknownArray(path)) throw new Error('Missing probe');
  const operation = path["get"];
  if (!operation || typeof operation !== 'object' || isUnknownArray(operation)) throw new Error('Missing operation');
  const responses = operation["responses"];
  if (!responses || typeof responses !== 'object' || isUnknownArray(responses)) throw new Error('Missing responses');
  const response = responses['200'];
  if (!response || typeof response !== 'object' || isUnknownArray(response)) throw new Error('Missing response');
  const content = response["content"];
  if (!content || typeof content !== 'object' || isUnknownArray(content)) throw new Error('Missing content');
  const media = content['application/json'];
  if (!media || typeof media !== 'object' || isUnknownArray(media)) throw new Error('Missing media');
  return media["schema"];
}

describe('narrow OpenAPI 3.0 schema conversion', () => {
  test.each(['literal', false, 0, { type: 'null', const: 'data', schema: { patternProperties: 'data' } }])(
    'preserves a literal value as a singleton enum',
    literal => {
      expect(outputSchema({ const: literal })).toEqual({ enum: [literal] });
    },
  );

  test('intersects an existing enum with const without accepting its other alternatives', () => {
    expect(outputSchema({ type: 'string', enum: ['a', 'b'], const: 'b', minLength: 1 }))
      .toEqual({ type: 'string', enum: ['b'], minLength: 1 });
    expect(() => outputSchema({ const: 'a', enum: ['b'] })).toThrow('conflicts');
  });

  test('represents only null with a typed nullable singleton enum', () => {
    const nullable = { type: 'string', nullable: true, enum: [null] };
    expect(outputSchema({ type: 'null' })).toEqual(nullable);
    expect(outputSchema({ const: null })).toEqual(nullable);
    expect(outputSchema({ type: 'null', default: null, description: 'nullable value' }))
      .toEqual({ ...nullable, default: null, description: 'nullable value' });
    expect(outputSchema({ anyOf: [{ type: 'string', minLength: 2 }, { type: 'null' }] }))
      .toEqual({ anyOf: [{ type: 'string', minLength: 2 }, nullable] });
    expect(outputSchema({ oneOf: [{ type: 'null' }, { type: 'null' }] }))
      .toEqual({ oneOf: [nullable, nullable] });
  });

  test.each([
    { type: 'null', minLength: 1 },
    { type: 'null', enum: ['not-null'] },
    { type: 'null', nullable: false },
    { type: 'null', default: 'not-null' },
    { type: 'string', const: null },
  ])('rejects null shapes whose other constraints cannot be preserved', schema => {
    expect(() => outputSchema(schema)).toThrow(OpenApi30ConversionError);
  });

  test('converts only an explicit all-string-key dictionary and preserves value constraints', () => {
    expect(outputSchema({
      type: 'object',
      minProperties: 1,
      patternProperties: { '^[\\s\\S]*$': { type: 'string', minLength: 2 } },
    })).toEqual({
      type: 'object',
      minProperties: 1,
      additionalProperties: { type: 'string', minLength: 2 },
    });
  });

  test.each([
    { type: 'object', patternProperties: { '^(.*)$': { type: 'string' } } },
    { type: 'object', patternProperties: { '^prefix': { type: 'string' } } },
    { type: 'object', patternProperties: { '^[\\s\\S]*$': {}, '^x': {} } },
    { type: 'object', properties: { named: {} }, patternProperties: { '^[\\s\\S]*$': {} } },
    { type: 'object', additionalProperties: false, patternProperties: { '^[\\s\\S]*$': {} } },
  ])('blocks unproven pattern conversions', schema => {
    expect(() => outputSchema(schema)).toThrow(OpenApi30ConversionError);
  });

  test('does not interpret metadata data keys as schema keywords', () => {
    const data = { schema: { type: 'null', const: false }, patternProperties: { '^(.*)$': 'data' }, $id: 'data' };
    const input = { type: 'object', example: data, default: data, 'x-sample': data };
    expect(outputSchema(input)).toEqual(input);
    expect(outputSchema({ enum: [data] })).toEqual({ enum: [data] });
    expect(outputSchema({ const: data })).toEqual({ enum: [data] });
  });

  test('omits only empty schema required lists without changing the source or other constraints', () => {
    const input = {
      type: 'object',
      required: [],
      additionalProperties: false,
      properties: { nested: { type: 'object', required: [], minProperties: 1 } },
    };
    const before = structuredClone(input);
    expect(outputSchema(input)).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: { nested: { type: 'object', minProperties: 1 } },
    });
    expect(input).toEqual(before);
    expect(outputSchema({ type: 'null', required: [] }))
      .toEqual({ type: 'string', nullable: true, enum: [null] });
    const required = { type: 'object', required: ['name'], properties: { name: { type: 'string' } } };
    expect(outputSchema(required)).toEqual(required);
  });

  test('retains empty required arrays in literal and annotation data', () => {
    const data = { required: [], schema: { required: [] } };
    const input = { type: 'object', required: [], default: data, example: data, 'x-sample': data };
    expect(outputSchema(input))
      .toEqual({ type: 'object', default: data, example: data, 'x-sample': data });
    expect(outputSchema({ const: data, required: [] })).toEqual({ enum: [data] });
    expect(outputSchema({ enum: [data], required: [] })).toEqual({ enum: [data] });
  });

  test('converts schemas for properties named like keywords, not the property map itself', () => {
    const names = ['schema', 'const', 'type', 'enum', 'default', 'example', 'patternProperties'];
    const properties = Object.fromEntries(names.map(name => [name, { const: name }]));
    expect(outputSchema({ type: 'object', properties })).toEqual({
      type: 'object',
      properties: Object.fromEntries(names.map(name => [name, { enum: [name] }])),
    });
  });

  test.each(['schema', 'enum', 'default', 'const', 'example', 'x-component'])(
    'distinguishes named component and header maps from schema fields: %s', name => {
    const input = {
      ...document({ type: 'string' }),
      components: {
        parameters: { [name]: { name: 'probe', in: 'query', schema: { const: 'parameter' } } },
        headers: { schema: { schema: { const: 'header' } } },
        responses: {
          schema: {
            description: 'response',
            headers: { schema: { schema: { const: 'response-header' } } },
            content: {
              'application/json': {
                schema: { const: 'response' },
                encoding: { schema: { headers: { schema: { schema: { const: 'encoding-header' } } } } },
              },
            },
          },
        },
        requestBodies: {
          schema: { content: { 'application/json': { schema: { const: 'body' } } } },
        },
        examples: { schema: { value: { schema: { const: 'example-data' }, required: [] } } },
        links: { schema: { operationId: 'probe', requestBody: { schema: { const: 'link-data' } } } },
        securitySchemes: { schema: { type: 'apiKey', in: 'header', name: 'schema' } },
        callbacks: {
          schema: {
            '{$request.body#/url}': {
              post: { responses: { '200': { description: 'ok', content: { 'application/json': { schema: { const: 'callback' } } } } } },
            },
          },
        },
      },
    };
    const before = structuredClone(input);
    const output = convertOpenApi30Schemas(input);
    expect(input).toEqual(before);
    const expected = structuredClone(input);
    const replaceLiterals = (value: unknown): unknown => {
      if (isUnknownArray(value)) return value.map(replaceLiterals);
      if (value === null || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(requireRecord(value)).map(([key, child]) =>
        key === 'const' ? ['enum', [child]] : [key, replaceLiterals(child)]));
    };
    expect(output.spec["components"]).toEqual({
      ...requireRecord(replaceLiterals(expected.components)),
      parameters: { [name]: { name: 'probe', in: 'query', schema: { enum: ['parameter'] } } },
      examples: expected.components.examples,
      links: expected.components.links,
    });
    },
  );

  test.each(['anyOf', 'allOf', 'oneOf'])('resolves canonical schema references through %s array indices', keyword => {
    const input = {
      ...document({ $ref: `#/components/schemas/Choice/${keyword}/0` }),
      components: { schemas: { Choice: { [keyword]: [{ const: 'allowed' }] } } },
    };
    const before = structuredClone(input);
    const canonical = canonicalizeOpenApiReferences(input, []);
    const converted = convertOpenApi30Schemas(canonical.spec, canonical.inventory);
    expect(converted.spec["components"]).toEqual({
      schemas: { Choice: { [keyword]: [{ enum: ['allowed'] }] } },
    });
    expect(input).toEqual(before);
    expect(JSON.stringify(converted.spec)).toContain(`#/components/schemas/Choice/${keyword}/0`);
  });

  test.each(['length', '01', '-1', '1', '-'])('rejects non-index or missing array reference segments: %s', index => {
    const input = {
      ...document({ $ref: `#/components/schemas/Choice/anyOf/${index}` }),
      components: { schemas: { Choice: { anyOf: [{ const: 'allowed' }] } } },
    };
    expect(() => convertOpenApi30Schemas(input)).toThrow(OpenApi30ConversionError);
  });

  test('canonicalizes recursive references first and leaves the runtime source untouched', () => {
    const schema = {
      $id: 'RecursiveJson',
      anyOf: [
        { type: 'null' },
        { type: 'array', items: { $ref: 'RecursiveJson' } },
        { type: 'object', patternProperties: { '^[\\s\\S]*$': { $ref: 'RecursiveJson' } } },
      ],
    };
    const input = document(schema);
    const before = structuredClone(input);
    expect(() => convertOpenApi30Schemas(input)).toThrow('keyword');
    const canonical = canonicalizeOpenApiReferences(input, []);
    const beforeCanonical = structuredClone(canonical);
    const converted = convertOpenApi30Schemas(canonical.spec, canonical.inventory);
    expect(input).toEqual(before);
    expect(canonical).toEqual(beforeCanonical);
    expect(converted.spec["openapi"]).toBe('3.0.3');
    expect(JSON.stringify(converted)).toContain('"$ref":"#/components/schemas/RecursiveJson"');
    expect(JSON.stringify(converted)).not.toContain('"type":"null"');
    expect(JSON.stringify(converted)).not.toContain('"patternProperties"');
  });

  test('converts request, input extension, components, inventory and response status-map schemas', () => {
    const input = document({ const: true });
    const body = { type: 'object', properties: { enabled: { const: true } } };
    const routes = [{
      operation: {
        'x-supauth-input-schema': body,
        'x-supauth-bindings': {
          body,
          query: { type: 'object', properties: { mode: { const: 'safe' } } },
          response: { '200': { const: true }, '4XX': { type: 'null' }, default: { const: false } },
        },
      },
    }];
    const before = structuredClone(routes);
    const output = convertOpenApi30Schemas(input, routes);
    expect(routes).toEqual(before);
    expect(JSON.stringify(output)).not.toContain('"const"');
    expect(JSON.stringify(output)).not.toContain('"type":"null"');
    expect(JSON.stringify(output.inventory)).toContain('"4XX":{"type":"string","nullable":true,"enum":[null]}');
    expect(JSON.stringify(output.inventory)).toContain('"enum":["safe"]');
  });

  test('converts standard request and parameter schemas while retaining transport contracts', () => {
    const input = document({ type: 'string' });
    const before = {
      ...input,
      paths: {
        '/probe': {
          post: {
            operationId: 'submitProbe',
            security: [{ bearerAuth: [] }],
            parameters: [{ in: 'query', name: 'mode', required: true, schema: { const: 'safe' } }],
            requestBody: { required: true, content: { 'application/json': { schema: { type: 'null' } } } },
            responses: { '204': { description: 'no content' } },
          },
        },
      },
    };
    const expected = structuredClone(before);
    const after = convertOpenApi30Schemas(before);
    expect(before).toEqual(expected);
    expect(JSON.stringify(after.spec)).toContain('"name":"mode","required":true,"schema":{"enum":["safe"]}');
    expect(JSON.stringify(after.spec)).toContain('"schema":{"type":"string","nullable":true,"enum":[null]}');
    expect(JSON.stringify(after.spec)).toContain('"responses":{"204":{"description":"no content"}}');
    expect(JSON.stringify(after.spec)).toContain('"security":[{"bearerAuth":[]}]');
    expect(convertOpenApi30Schemas(after.spec, after.inventory)).toEqual(after);
  });

  test.each([
    { type: 'undefined' },
    { type: ['string', 'null'] },
    { type: 'array', items: [{ type: 'string' }] },
    { type: 'array' },
    { type: 'string', exclusiveMinimum: 1 },
    { type: 'object', dependencies: { field: {} } },
    { if: { type: 'string' }, then: { minLength: 2 } },
    { anyOf: [] },
    { required: 'name' },
    { required: null },
    { required: [1] },
    { required: ['name', false] },
    { required: ['name', 'name'] },
    { type: 'object', properties: { value: false } },
    { const: undefined },
    { $ref: 'Unresolved' },
    { $ref: '#/components/schemas/Missing' },
    { $ref: '#/components/schemas/Missing', minLength: 1 },
  ])('fails on unsupported or malformed schema shapes', schema => {
    expect(() => outputSchema(schema)).toThrow(OpenApi30ConversionError);
  });

  test('rejects getter values without invoking or retaining them', () => {
    let reads = 0;
    const schema = Object.defineProperty({}, 'const', {
      enumerable: true,
      get() { reads++; return 'fixture-private-value'; },
    });
    try {
      outputSchema(schema);
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(OpenApi30ConversionError);
      expect(String(error)).not.toContain('fixture-private-value');
    }
    expect(reads).toBe(0);
  });

  test('rejects unsupported versions without changing the requested dialect', () => {
    expect(() => convertOpenApi30Schemas({ ...document({}), openapi: '3.1.0' })).toThrow(OpenApi30ConversionError);
    expect(() => convertOpenApi30Schemas(document({}), {})).toThrow(OpenApi30ConversionError);
  });
});
